import { PAID_STATUSES, type OrderStatus } from '@istock/shared';
import type { Order } from './models.js';
import { MAX_INVOICE_TTL_MS } from './order-transitions.js';

/** Apps every new promo code covers unless the admin names another number. */
export const DEFAULT_PROMO_MAX_APPS = 5;
export const PROMO_MAX_APPS_LIMIT = 100;

/**
 * Unpaid orders whose invoice the provider may still accept. A cancelled order keeps its place too:
 * the buyer can still pay the invoice until it expires, and that late payment is honoured.
 */
export const PROMO_PENDING_STATUSES: readonly OrderStatus[] = ['awaiting_payment', 'cancelled'];

/**
 * Unpaid orders created after this moment still hold their apps of the promo code. The longest
 * invoice lifetime is used for every method: a place is never given away while an invoice is payable.
 */
export function promoHoldSince(now: Date): Date {
  return new Date(now.getTime() - MAX_INVOICE_TTL_MS);
}

/** Paid orders and unpaid ones with a live invoice count against the code; refunds free their apps. */
export function holdsPromoApps(order: Pick<Order, 'status' | 'createdAt'>, holdSince: Date): boolean {
  if (PAID_STATUSES.includes(order.status)) return true;
  return PROMO_PENDING_STATUSES.includes(order.status) && order.createdAt > holdSince;
}
