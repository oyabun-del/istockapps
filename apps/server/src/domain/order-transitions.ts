import type { OrderStatus, PaymentMethod } from '@istock/shared';

const MS_PER_MINUTE = 60 * 1000;
/** Platega expires an unpaid SBP invoice 15 minutes after it is created (expiresIn in its response). */
const SBP_INVOICE_TTL_MS = 15 * MS_PER_MINUTE;
/** CisPay expires an unpaid card invoice after 30 minutes (GET /payments/status, status EXPIRED). */
const CARD_INVOICE_TTL_MS = 30 * MS_PER_MINUTE;

/** The longest any provider keeps an unpaid invoice open: windows that span every method use it. */
export const MAX_INVOICE_TTL_MS = Math.max(SBP_INVOICE_TTL_MS, CARD_INVOICE_TTL_MS);

/** How long the provider of this method keeps an unpaid invoice open. */
export function invoiceTtlMs(method: PaymentMethod): number {
  return method === 'CARD' ? CARD_INVOICE_TTL_MS : SBP_INVOICE_TTL_MS;
}

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
