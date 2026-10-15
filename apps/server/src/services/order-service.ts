import { randomUUID } from 'node:crypto';
import type { AppDto, CreateOrderInput, PaymentMethod } from '@istock/shared';
import type { Order, User } from '../domain/models.js';
import { allowedSourcesFor } from '../domain/order-transitions.js';
import { AppError, getErrorMessage } from '../lib/app-error.js';
import type { Logger } from '../lib/logger.js';
import type { CatalogProvider } from '../providers/catalog/catalog-provider.js';
import type { PaymentProvider, PaymentStatus } from '../providers/payment/payment-provider.js';
import type { Repositories } from '../repositories/repositories.js';
import type { NotificationService } from './notification-service.js';
import { getOwnedOrder } from './order-access.js';

/** A fresh unpaid order for the same app is reused instead of creating a new invoice. */
const PENDING_REUSE_WINDOW_MS = 30 * 60 * 1000;
/** Fallback polling of CISPAY when the webhook is late. */
export const PAYMENT_SYNC_INTERVAL_MS = 15_000;
const ORDER_LIST_LIMIT = 50;
/** CISPAY: minimum for CARD is 50 ₽. */
const MIN_AMOUNT_KOPECKS: Partial<Record<PaymentMethod, number>> = { CARD: 5000 };

export interface PaymentUpdate {
  paymentId: string;
  status: PaymentStatus;
  amountKopecks: number;
  isSandbox: boolean;
}

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

  async listPaymentMethods(): Promise<PaymentMethod[]> {
    try {
      return await this.deps.payments.listMethods();
    } catch (error: unknown) {
      this.deps.logger.error({ err: getErrorMessage(error) }, 'Failed to load payment methods');
      throw new AppError('PAYMENT_PROVIDER_ERROR', 'Платёжный сервис временно недоступен', { cause: error });
    }
  }

  async createOrder(user: User, input: CreateOrderInput): Promise<Order> {
    const { repos } = this.deps;
    const app = await this.loadApp(input.appId);

    const methods = await this.listPaymentMethods();
    const minAmount = MIN_AMOUNT_KOPECKS[input.paymentMethod] ?? 0;
    if (!methods.includes(input.paymentMethod) || app.priceKopecks < minAmount) {
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
    method: PaymentMethod,
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

  /** Applies a verified payment webhook. Safe to call repeatedly with the same payload. */
  async handlePaymentWebhook(paymentOrderId: string, update: PaymentUpdate): Promise<void> {
    const order = await this.deps.repos.orders.findByPaymentOrderId(paymentOrderId);
    if (!order) {
      this.deps.logger.warn({ paymentOrderId }, 'Webhook for unknown order ignored');
      return;
    }
    if (order.paymentId && order.paymentId !== update.paymentId) {
      this.deps.logger.warn({ orderId: order.id }, 'Webhook payment id mismatch ignored');
      return;
    }
    if (update.isSandbox && !this.deps.acceptSandboxPayments) {
      this.deps.logger.warn({ orderId: order.id, status: update.status }, 'Sandbox payment ignored');
      return;
    }
    // Payment creation may have timed out on our side while CISPAY created it: bind it now.
    const bound = order.paymentId
      ? order
      : await this.deps.repos.orders.update(order.id, { paymentId: update.paymentId });
    await this.applyPaymentUpdate(bound, update);
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
      isSandbox: false,
    });
    return (await this.deps.repos.orders.findById(order.id)) ?? synced;
  }

  private async applyPaymentUpdate(order: Order, update: PaymentUpdate): Promise<void> {
    const { repos, notifications } = this.deps;

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
        await repos.orderEvents.add(order.id, 'paid', { sandbox: update.isSandbox });
        const user = await repos.users.findById(paid.userId);
        await notifications.purchaseCompleted(paid, user, update.isSandbox);
        await notifications.notifyBuyerPaid(paid);
        return;
      }
      case 'FAILED':
      case 'EXPIRED': {
        const status = update.status === 'FAILED' ? 'failed' : 'expired';
        const changed = await repos.orders.transition(order.id, allowedSourcesFor(status), { status });
        if (changed) await repos.orderEvents.add(order.id, status);
        return;
      }
      case 'REFUNDED': {
        const refunded = await repos.orders.transition(order.id, allowedSourcesFor('refunded'), {
          status: 'refunded',
        });
        if (!refunded) return;
        await repos.orderEvents.add(order.id, 'refunded');
        await notifications.orderRefunded(refunded);
        return;
      }
    }
  }
}
