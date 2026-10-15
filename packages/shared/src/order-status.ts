/**
 * Order lifecycle. Transitions are enforced on the server only.
 *
 * awaiting_payment → paid → download_confirmed → credentials_issued → completed
 * awaiting_payment → failed | expired | cancelled (by the buyer)
 * paid.. → refunded
 */
export const ORDER_STATUSES = [
  'awaiting_payment',
  'paid',
  'download_confirmed',
  'credentials_issued',
  'completed',
  'failed',
  'expired',
  'cancelled',
  'refunded',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Statuses in which the buyer has paid and may proceed with delivery. */
export const PAID_STATUSES: readonly OrderStatus[] = [
  'paid',
  'download_confirmed',
  'credentials_issued',
  'completed',
];

/** Statuses after which nothing else can happen to the order. */
export const TERMINAL_STATUSES: readonly OrderStatus[] = ['completed', 'failed', 'expired', 'cancelled', 'refunded'];

export function isPaidStatus(status: OrderStatus): boolean {
  return PAID_STATUSES.includes(status);
}

export function isTerminalStatus(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}
