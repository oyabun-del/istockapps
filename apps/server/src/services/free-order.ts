import { isPaidStatus } from '@istock/shared';
import type { NewOrder, Order, PromoCode, User } from '../domain/models.js';
import { allowedSourcesFor } from '../domain/order-transitions.js';
import { promoHoldSince } from '../domain/promo.js';
import { AppError, getErrorMessage } from '../lib/app-error.js';
import type { Logger } from '../lib/logger.js';
import type { Repositories } from '../repositories/repositories.js';
import { promoLimitError } from './checkout-gate.js';
import type { NotificationService } from './notification-service.js';
import { findBuyer } from './order-access.js';
import { recordOrderEvent } from './order-events.js';

/** A second tap on «Получить бесплатно» within this window gets the order already handed out. */
export const FREE_ORDER_REPEAT_WINDOW_MS = 2 * 60 * 1000;
/** A buyer's latest orders looked through for that repeat; far more than one checkout makes. */
const RECENT_ORDERS_LIMIT = 10;

export interface FreeOrderDeps {
  repos: Pick<Repositories, 'orders' | 'orderEvents' | 'users'>;
  notifications: Pick<NotificationService, 'freePurchaseCompleted' | 'notifyBuyerPaid'>;
  logger: Logger;
  now: () => Date;
}

/** The whole cart is covered by the code: nothing to pay, every app discounted in full. */
export function toFreeOrder(order: NewOrder): NewOrder {
  return {
    ...order,
    items: order.items.map((item) => ({ ...item, discountKopecks: item.priceKopecks })),
    discountKopecks: order.subtotalKopecks,
    amountKopecks: 0,
    paymentMethod: 'PROMO',
  };
}

function isSameApps(order: Order, appIds: ReadonlySet<string>): boolean {
  return order.items.length === appIds.size && order.items.every((item) => appIds.has(item.appId));
}

/**
 * Orders paid for by a free promo code. No invoice is opened, so the payment service is never asked:
 * the order is created within the code's app limit and is paid at once. Callers serialize checkouts
 * of one buyer, which makes the repeat check below safe.
 */
export class FreeOrderCheckout {
  constructor(private readonly deps: FreeOrderDeps) {}

  async handOut(user: User, order: NewOrder, promo: PromoCode): Promise<Order> {
    const repeated = await this.findRepeat(user.id, order, promo);
    if (repeated) return repeated;

    const created = await this.createWithinPromo(toFreeOrder(order), promo);
    await this.record(created.id, 'created', { method: created.paymentMethod, apps: created.items.length, promo: promo.code });
    const paid = await this.markPaid(created);

    // The transition is committed: nothing below may throw.
    await this.record(paid.id, 'paid', { promo: promo.code, free: true });
    const buyer = await findBuyer(this.deps.repos.users, this.deps.logger, paid.userId);
    await this.deps.notifications.freePurchaseCompleted(paid, buyer, promo.code);
    await this.deps.notifications.notifyBuyerPaid(paid);
    return paid;
  }

  /**
   * A double tap must not spend the code twice: the same apps handed out by the same code a moment ago
   * are the answer. Only an order that was really handed out counts, never one left unpaid by a failure.
   */
  private async findRepeat(userId: number, order: NewOrder, promo: PromoCode): Promise<Order | null> {
    const since = this.deps.now().getTime() - FREE_ORDER_REPEAT_WINDOW_MS;
    const appIds = new Set(order.items.map((item) => item.appId));
    const recent = await this.deps.repos.orders.listByUser(userId, RECENT_ORDERS_LIMIT);
    return (
      recent.find(
        (item) =>
          item.paymentMethod === 'PROMO' &&
          item.promoCodeId === promo.id &&
          isPaidStatus(item.status) &&
          item.createdAt.getTime() > since &&
          isSameApps(item, appIds),
      ) ?? null
    );
  }

  /**
   * A free order has no invoice that could still be paid, so one that did not become paid is closed as
   * failed: it must not hold the code's apps or wait for a payment forever.
   */
  private async markPaid(created: Order): Promise<Order> {
    const { orders } = this.deps.repos;
    let paid: Order | null;
    try {
      paid = await orders.transition(created.id, allowedSourcesFor('paid'), {
        status: 'paid',
        paidAt: this.deps.now(),
        isSandbox: false,
      });
    } catch (error: unknown) {
      await this.closeAsFailed(created.id);
      throw error;
    }
    if (paid) return paid;
    await this.closeAsFailed(created.id);
    throw new AppError('INVALID_STATE', 'Не удалось оформить заказ. Попробуйте ещё раз.');
  }

  private async closeAsFailed(orderId: number): Promise<void> {
    try {
      const failed = await this.deps.repos.orders.transition(orderId, allowedSourcesFor('failed'), { status: 'failed' });
      if (failed) await this.record(orderId, 'failed', { free: true });
    } catch (error: unknown) {
      this.deps.logger.error({ orderId, err: getErrorMessage(error) }, 'Failed to close an unpaid free order');
    }
  }

  private async createWithinPromo(order: NewOrder, promo: PromoCode): Promise<Order> {
    const { orders } = this.deps.repos;
    const holdSince = promoHoldSince(this.deps.now());
    const created = await orders.createWithinPromo({ ...order, promoCodeId: promo.id }, promo.maxApps, holdSince);
    if (created) return created;
    const used = await orders.countPromoApps(promo.id, holdSince);
    throw promoLimitError(Math.max(0, promo.maxApps - used));
  }

  private record(orderId: number, type: string, data: Record<string, unknown>): Promise<void> {
    return recordOrderEvent(this.deps.repos.orderEvents, this.deps.logger, orderId, type, data);
  }
}
