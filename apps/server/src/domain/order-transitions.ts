import type { OrderStatus } from '@istock/shared';

/** Platega expires an unpaid invoice 15 minutes after it is created (expiresIn in its response). */
export const INVOICE_TTL_MS = 15 * 60 * 1000;

/** Allowed source statuses for each target status. */
const ALLOWED_FROM: Record<OrderStatus, readonly OrderStatus[]> = {
  awaiting_payment: [],
  // A late payment still counts, even after the buyer cancelled or the invoice expired.
  paid: ['awaiting_payment', 'failed', 'expired', 'cancelled'],
  download_confirmed: ['paid'],
  credentials_issued: ['download_confirmed'],
  completed: ['credentials_issued'],
  failed: ['awaiting_payment'],
  expired: ['awaiting_payment'],
  cancelled: ['awaiting_payment'],
  refunded: ['paid', 'download_confirmed', 'credentials_issued', 'completed'],
};

export function allowedSourcesFor(target: OrderStatus): readonly OrderStatus[] {
  return ALLOWED_FROM[target];
}
