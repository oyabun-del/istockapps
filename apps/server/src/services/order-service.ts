import { randomUUID } from 'node:crypto';
import { ACTIVE_PAYMENT_METHOD, type ActivePaymentMethod, type AppDto, type CreateOrderInput } from '@istock/shared';
import type { Order, User } from '../domain/models.js';
import { allowedSourcesFor, INVOICE_TTL_MS } from '../domain/order-transitions.js';
import { AppError, getErrorMessage } from '../lib/app-error.js';
import type { Logger } from '../lib/logger.js';
import type { CatalogProvider } from '../providers/catalog/catalog-provider.js';
import type { PaymentProvider, PaymentStatus } from '../providers/payment/payment-provider.js';
import type { Repositories } from '../repositories/repositories.js';
import type { NotificationService } from './notification-service.js';
import { getOwnedOrder } from './order-access.js';

/** A fresh unpaid order for the same app is reused instead of creating a new invoice. */
const PENDING_REUSE_WINDOW_MS = INVOICE_TTL_MS;
/** Fallback polling of CISPAY when the webhook is late. */
export const PAYMENT_SYNC_INTERVAL_MS = 15_000;
const ORDER_LIST_LIMIT = 50;

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

export class OrderService {
  private readonly now: () => Date;

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

  async createOrder(user: User, input: CreateOrderInput): Promise<Order> {
    const { repos } = this.deps;
    const app = await this.loadApp(input.appId);

    const methods = await this.listPaymentMethods();
    if (!methods.includes(input.paymentMethod)) {
      throw new AppError('PAYMENT_METHOD_UNAVAILABLE', 'Этот способ оплаты сейчас недоступен');
    }

    await repos.users.upsert(user);

    const reuseAfter = new Date(this.now().getTime() - PENDING_REUSE_WINDOW_MS);
    const pending = await repos.orders.findPendingForApp(user.id, app.id, reuseAfter);
    const reusable = await this.reusablePendingOrder(pending, input.paymentMethod, app.priceKopecks);
    if (reusable) return reusable;

    const order = await repos.orders.create({
      paymentOrderId: randomUUID(),
      userId: user.id,
      appId: app.id,
      appName: app.name,
      appIconUrl: app.iconUrl,
      amountKopecks: app.priceKopecks,
      paymentMethod: input.paymentMethod,
      status: 'awaiting_payment',
    });
    await repos.orderEvents.add(order.id, 'created', { method: input.paymentMethod });

    try {
      const returnUrl = this.deps.returnUrl(order);
      const payment = await this.deps.payments.createPayment({
        orderId: order.paymentOrderId,
        amountKopecks: order.amountKopecks,
        method: order.paymentMethod,
        customerId: String(user.id),
        description: `${app.name}, заказ #${order.id}`,
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

  private async loadApp(appId: string): Promise<AppDto> {
    let app: AppDto | null;
    try {
      app = await this.deps.catalog.getApp(appId);
    } catch (error: unknown) {
      this.deps.logger.error({ appId, err: getErrorMessage(error) }, 'Catalog lookup failed');
      throw new AppError('CATALOG_PROVIDER_ERROR', 'Каталог временно недоступен', { cause: error });
    }
    if (!app) throw new AppError('NOT_FOUND', 'Приложение не найдено');
    return app;
  }

  /** Reuses a fresh unpaid invoice only if CISPAY still considers it payable. */
  private async reusablePendingOrder(
    pending: Order | null,
    method: ActivePaymentMethod,
    priceKopecks: number,
  ): Promise<Order | null> {
    if (!pending || pending.paymentMethod !== method || pending.amountKopecks !== priceKopecks) return null;
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
    await this.applyPaymentUpdate(bound, update);
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
    if (order.status !== 'awaiting_payment' || !order.paymentId) return false;
    if (!order.paymentSyncedAt) return true;
    return this.now().getTime() - order.paymentSyncedAt.getTime() >= PAYMENT_SYNC_INTERVAL_MS;
  }

  private async syncPayment(order: Order): Promise<Order> {
    const paymentId = order.paymentId as string;
    const state = await this.deps.payments.getPayment(paymentId);
    const synced = await this.deps.repos.orders.update(order.id, { paymentSyncedAt: this.now() });
    await this.applyPaymentUpdate(synced, {
      paymentId,
      status: state.status,
      amountKopecks: state.amountKopecks,
      isSandbox: state.isSandbox,
    });
    return (await this.deps.repos.orders.findById(order.id)) ?? synced;
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

  /** Audit trail after a committed transition: a failure is logged, never propagated. */
  private async recordEvent(orderId: number, type: string, data?: Record<string, unknown>): Promise<void> {
    try {
      await this.deps.repos.orderEvents.add(orderId, type, data);
    } catch (error: unknown) {
      this.deps.logger.error({ orderId, type, err: getErrorMessage(error) }, 'Failed to record order event');
    }
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
