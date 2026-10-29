import { randomUUID } from 'node:crypto';
import {
  ACTIVE_PAYMENT_METHOD,
  calculateCartPricing,
  type ActivePaymentMethod,
  type AppDto,
  type CartPricing,
  type CreateOrderInput,
} from '@istock/shared';
import type { NewOrder, Order, User } from '../domain/models.js';
import { describeApps } from '../domain/order-items.js';
import { allowedSourcesFor, INVOICE_TTL_MS } from '../domain/order-transitions.js';
import { AppError, getErrorMessage } from '../lib/app-error.js';
import { KeyedLock } from '../lib/keyed-lock.js';
import type { Logger } from '../lib/logger.js';
import type { CatalogProvider } from '../providers/catalog/catalog-provider.js';
import type { PaymentProvider, PaymentStatus } from '../providers/payment/payment-provider.js';
import type { Repositories } from '../repositories/repositories.js';
import type { NotificationService } from './notification-service.js';
import { getOwnedOrder } from './order-access.js';
import { recordOrderEvent } from './order-events.js';

/** A fresh unpaid order for the same app is reused instead of creating a new invoice. */
const PENDING_REUSE_WINDOW_MS = INVOICE_TTL_MS;
/** Fallback polling of CISPAY when the webhook is late. */
export const PAYMENT_SYNC_INTERVAL_MS = 15_000;
/**
 * A cancelled or expired order is still polled this long after creation: the buyer may pay the
 * invoice until CISPAY closes it, and that payment must not depend on the webhook alone.
 */
export const LATE_PAYMENT_WINDOW_MS = INVOICE_TTL_MS + 30 * 60 * 1000;
/** Orders checked by one background reconciliation pass. */
const RECONCILE_BATCH_LIMIT = 100;
const ORDER_LIST_LIMIT = 50;
/** Statuses a payment can still move to "paid"; their invoices are worth polling. */
const PAYABLE_STATUSES = allowedSourcesFor('paid');

export interface PaymentUpdate {
  paymentId: string;
  status: PaymentStatus;
  amountKopecks: number;
  isSandbox: boolean;
}

/** Verified webhook payload; a null amount (non-ruble currency) is confirmed via the payment API. */
export type PaymentNotice = Omit<PaymentUpdate, 'amountKopecks'> & { amountKopecks: number | null };

export interface OrderServiceDeps {
  repos: Repositories;
  catalog: CatalogProvider;
  payments: PaymentProvider;
  notifications: NotificationService;
  logger: Logger;
  /** Where CISPAY sends the buyer after paying (deep link back into the Mini App). */
  returnUrl: (order: Order) => string | null;
  /** CISPAY sandbox payments unlock delivery only when this is true (never in production by default). */
  acceptSandboxPayments: boolean;
  now?: () => Date;
}

/** CISPAY rejects longer descriptions (PaymentCreateRequest.description maxLength). */
const PAYMENT_DESCRIPTION_MAX = 512;

/** "СберБанк Онлайн, Т-Банк, заказ #12"; long app lists are cut so the order number always fits. */
function paymentDescription(order: Order): string {
  const suffix = `, заказ #${order.id}`;
  const apps = describeApps(order);
  const room = PAYMENT_DESCRIPTION_MAX - suffix.length;
  return `${apps.length > room ? `${apps.slice(0, room - 1)}…` : apps}${suffix}`;
}

function buildNewOrder(
  user: User,
  apps: readonly AppDto[],
  pricing: CartPricing,
  method: ActivePaymentMethod,
): NewOrder {
  return {
    paymentOrderId: randomUUID(),
    userId: user.id,
    items: apps.map((app, index) => ({
      appId: app.id,
      appName: app.name,
      appIconUrl: app.iconUrl,
      priceKopecks: app.priceKopecks,
      discountKopecks: pricing.items[index]?.discountKopecks ?? 0,
    })),
    subtotalKopecks: pricing.subtotalKopecks,
    discountKopecks: pricing.discountKopecks,
    amountKopecks: pricing.totalKopecks,
    paymentMethod: method,
    status: 'awaiting_payment',
  };
}

export class OrderService {
  private readonly now: () => Date;
  /** Two checkouts of one buyer at once must not both miss the pending order and open two invoices. */
  private readonly checkoutLocks = new KeyedLock<number>();
  /** Webhooks and polling of one order are applied one at a time (one-shot alerts check, then write). */
  private readonly paymentLocks = new KeyedLock<number>();

  constructor(private readonly deps: OrderServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** SBP when CISPAY has it enabled for the shop, otherwise nothing: other methods are not offered. */
  async listPaymentMethods(): Promise<ActivePaymentMethod[]> {
    try {
      const methods = await this.deps.payments.listMethods();
      return methods.filter((method): method is ActivePaymentMethod => method === ACTIVE_PAYMENT_METHOD);
    } catch (error: unknown) {
      this.deps.logger.error({ err: getErrorMessage(error) }, 'Failed to load payment methods');
      throw new AppError('PAYMENT_PROVIDER_ERROR', 'Платёжный сервис временно недоступен', { cause: error });
    }
  }

  /** One order and one payment for all apps of the cart; the bulk discount is applied here. */
  async createOrder(user: User, input: CreateOrderInput): Promise<Order> {
    const { repos } = this.deps;
    const apps = await this.loadApps(input.appIds);
    const pricing = calculateCartPricing(apps.map((app) => app.priceKopecks));
    if (input.expectedTotalKopecks !== undefined && input.expectedTotalKopecks !== pricing.totalKopecks) {
      throw new AppError('PRICE_CHANGED', 'Цены обновились. Проверьте корзину и оплатите ещё раз.');
    }

    const methods = await this.listPaymentMethods();
    if (!methods.includes(input.paymentMethod)) {
      throw new AppError('PAYMENT_METHOD_UNAVAILABLE', 'Этот способ оплаты сейчас недоступен');
    }

    await repos.users.upsert(user);

    return this.checkoutLocks.run(user.id, async () => {
      const reuseAfter = new Date(this.now().getTime() - PENDING_REUSE_WINDOW_MS);
      const pending = await repos.orders.findPendingForApps(user.id, input.appIds, reuseAfter);
      const reusable = await this.reusablePendingOrder(pending, input.paymentMethod, pricing.totalKopecks);
      if (reusable) return reusable;

      const order = await repos.orders.create(buildNewOrder(user, apps, pricing, input.paymentMethod));
      await repos.orderEvents.add(order.id, 'created', { method: input.paymentMethod, apps: order.items.length });
      return this.openPayment(order, user);
    });
  }

  private async openPayment(order: Order, user: User): Promise<Order> {
    const { repos } = this.deps;
    try {
      const returnUrl = this.deps.returnUrl(order);
      const payment = await this.deps.payments.createPayment({
        orderId: order.paymentOrderId,
        amountKopecks: order.amountKopecks,
        method: order.paymentMethod,
        customerId: String(user.id),
        description: paymentDescription(order),
        successUrl: returnUrl,
        failUrl: returnUrl,
      });
      return await repos.orders.update(order.id, { paymentId: payment.paymentId, paymentUrl: payment.paymentUrl });
    } catch (error: unknown) {
      this.deps.logger.error({ orderId: order.id, err: getErrorMessage(error) }, 'Failed to create payment');
      await repos.orders.transition(order.id, ['awaiting_payment'], { status: 'failed' });
      await repos.orderEvents.add(order.id, 'payment_create_failed');
      throw new AppError('PAYMENT_PROVIDER_ERROR', 'Не удалось создать платёж. Попробуйте ещё раз.', {
        cause: error,
      });
    }
  }

  /** Same order as the ids; any missing app fails the whole order. */
  private async loadApps(appIds: readonly string[]): Promise<AppDto[]> {
    let apps: Array<AppDto | null>;
    try {
      apps = await Promise.all(appIds.map((appId) => this.deps.catalog.getApp(appId)));
    } catch (error: unknown) {
      this.deps.logger.error({ appIds, err: getErrorMessage(error) }, 'Catalog lookup failed');
      throw new AppError('CATALOG_PROVIDER_ERROR', 'Каталог временно недоступен', { cause: error });
    }
    const found = apps.filter((app): app is AppDto => app !== null);
    if (found.length !== appIds.length) {
      throw new AppError('NOT_FOUND', 'Одно из приложений больше не продаётся. Обновите корзину.');
    }
    return found;
  }

  /** Reuses a fresh unpaid invoice only if CISPAY still considers it payable. */
  private async reusablePendingOrder(
    pending: Order | null,
    method: ActivePaymentMethod,
    totalKopecks: number,
  ): Promise<Order | null> {
    if (!pending || pending.paymentMethod !== method || pending.amountKopecks !== totalKopecks) return null;
    try {
      const synced = await this.syncPayment(pending);
      return synced.status === 'awaiting_payment' ? synced : null;
    } catch (error: unknown) {
      this.deps.logger.warn({ orderId: pending.id, err: getErrorMessage(error) }, 'Pending order check failed');
      return null;
    }
  }

  async listOrders(userId: number): Promise<Order[]> {
    return this.deps.repos.orders.listByUser(userId, ORDER_LIST_LIMIT);
  }

  /** Background safety net for missed webhooks, including invoices paid after the buyer cancelled. */
  async reconcilePayments(): Promise<void> {
    const createdAfter = new Date(this.now().getTime() - LATE_PAYMENT_WINDOW_MS);
    const orders = await this.deps.repos.orders.listForPaymentSync(PAYABLE_STATUSES, createdAfter, RECONCILE_BATCH_LIMIT);
    for (const order of orders) {
      if (!this.shouldSyncPayment(order)) continue;
      try {
        await this.syncPayment(order);
      } catch (error: unknown) {
        this.deps.logger.warn({ orderId: order.id, err: getErrorMessage(error) }, 'Payment reconciliation failed');
      }
    }
  }

  /** Returns the order; for unpaid orders also polls CISPAY in case the webhook was missed. */
  async getOrder(userId: number, orderId: number): Promise<Order> {
    const order = await getOwnedOrder(this.deps.repos.orders, userId, orderId);
    if (!this.shouldSyncPayment(order)) return order;

    try {
      return await this.syncPayment(order);
    } catch (error: unknown) {
      this.deps.logger.warn({ orderId, err: getErrorMessage(error) }, 'Payment status sync failed');
      return order;
    }
  }

  /** Buyer gives up on an unpaid order. CISPAY has no cancel call: the invoice just expires on its side. */
  async cancelOrder(userId: number, orderId: number): Promise<Order> {
    const order = await getOwnedOrder(this.deps.repos.orders, userId, orderId);
    if (order.status === 'cancelled') return order;

    const cancelled = await this.deps.repos.orders.transition(order.id, allowedSourcesFor('cancelled'), {
      status: 'cancelled',
    });
    if (!cancelled) throw new AppError('INVALID_STATE', 'Этот заказ уже нельзя отменить');
    await this.recordEvent(order.id, 'cancelled');
    return cancelled;
  }

  /** Applies a verified payment webhook. Safe to call repeatedly with the same payload. */
  async handlePaymentWebhook(paymentOrderId: string, notice: PaymentNotice): Promise<void> {
    const order = await this.deps.repos.orders.findByPaymentOrderId(paymentOrderId);
    if (!order) {
      this.deps.logger.warn({ paymentOrderId }, 'Webhook for unknown order ignored');
      return;
    }
    if (order.paymentId && order.paymentId !== notice.paymentId) {
      this.deps.logger.warn({ orderId: order.id }, 'Webhook payment id mismatch ignored');
      return;
    }
    const update = await this.resolveAmount(notice);
    // Payment creation may have timed out on our side while CISPAY created it: bind it now.
    const bound = order.paymentId
      ? order
      : await this.deps.repos.orders.update(order.id, { paymentId: update.paymentId });
    await this.paymentLocks.run(order.id, () => this.applyPaymentUpdate(bound, update));
  }

  /** CISPAY reports CRYPTO webhooks in USD cents; its status API also returns the ruble amount. */
  private async resolveAmount(notice: PaymentNotice): Promise<PaymentUpdate> {
    if (notice.amountKopecks !== null) return { ...notice, amountKopecks: notice.amountKopecks };
    const state = await this.deps.payments.getPayment(notice.paymentId);
    return {
      paymentId: notice.paymentId,
      status: state.status,
      amountKopecks: state.amountKopecks,
      isSandbox: state.isSandbox,
    };
  }

  private shouldSyncPayment(order: Order): boolean {
    if (!order.paymentId || !PAYABLE_STATUSES.includes(order.status)) return false;
    const nowMs = this.now().getTime();
    // A closed invoice is polled only while CISPAY may still accept a payment for it.
    if (order.status !== 'awaiting_payment' && nowMs - order.createdAt.getTime() > LATE_PAYMENT_WINDOW_MS) return false;
    if (!order.paymentSyncedAt) return true;
    return nowMs - order.paymentSyncedAt.getTime() >= PAYMENT_SYNC_INTERVAL_MS;
  }

  private async syncPayment(order: Order): Promise<Order> {
    const paymentId = order.paymentId as string;
    const state = await this.deps.payments.getPayment(paymentId);
    await this.paymentLocks.run(order.id, () =>
      this.applyPaymentUpdate(order, {
        paymentId,
        status: state.status,
        amountKopecks: state.amountKopecks,
        isSandbox: state.isSandbox,
      }),
    );
    // Throttle only after the update applied, so a failed one is retried on the next read.
    return this.deps.repos.orders.update(order.id, { paymentSyncedAt: this.now() });
  }

  /** Shared by webhooks and polling, so both paths enforce the same rules. */
  private async applyPaymentUpdate(order: Order, update: PaymentUpdate): Promise<void> {
    const { repos, notifications } = this.deps;

    if (update.isSandbox && !this.deps.acceptSandboxPayments) {
      this.deps.logger.warn({ orderId: order.id, status: update.status }, 'Sandbox payment ignored');
      return;
    }

    switch (update.status) {
      case 'PENDING':
        return;
      case 'PAID': {
        if (update.amountKopecks !== order.amountKopecks) {
          this.deps.logger.error(
            { orderId: order.id, expected: order.amountKopecks, received: update.amountKopecks },
            'Paid amount mismatch',
          );
          // Polling and webhook retries repeat this; alert the admins once.
          if (await repos.orderEvents.has(order.id, 'amount_mismatch')) return;
          await repos.orderEvents.add(order.id, 'amount_mismatch', { received: update.amountKopecks });
          await notifications.paymentAmountMismatch(order, update.amountKopecks);
          return;
        }
        const paid = await repos.orders.transition(order.id, allowedSourcesFor('paid'), {
          status: 'paid',
          paidAt: this.now(),
        });
        if (!paid) return; // already processed
        // The transition is committed and a retry would skip it, so nothing below may throw.
        await this.recordEvent(order.id, 'paid', { sandbox: update.isSandbox });
        await notifications.purchaseCompleted(paid, await this.findBuyer(paid.userId), update.isSandbox);
        await notifications.notifyBuyerPaid(paid);
        return;
      }
      case 'FAILED':
      case 'EXPIRED': {
        const status = update.status === 'FAILED' ? 'failed' : 'expired';
        const changed = await repos.orders.transition(order.id, allowedSourcesFor(status), { status });
        if (changed) await this.recordEvent(order.id, status);
        return;
      }
      case 'REFUNDED': {
        const refunded = await repos.orders.transition(order.id, allowedSourcesFor('refunded'), {
          status: 'refunded',
        });
        if (!refunded) return;
        await this.recordEvent(order.id, 'refunded');
        await notifications.orderRefunded(refunded);
        return;
      }
    }
  }

  private recordEvent(orderId: number, type: string, data?: Record<string, unknown>): Promise<void> {
    return recordOrderEvent(this.deps.repos.orderEvents, this.deps.logger, orderId, type, data);
  }

  /** The admin notification still goes out (with the bare id) if the user lookup fails. */
  private async findBuyer(userId: number): Promise<User | null> {
    try {
      return await this.deps.repos.users.findById(userId);
    } catch (error: unknown) {
      this.deps.logger.error({ userId, err: getErrorMessage(error) }, 'Failed to load buyer for notification');
      return null;
    }
  }
}
