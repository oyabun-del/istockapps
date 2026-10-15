import type { OrderStatus } from '@istock/shared';

/** Allowed source statuses for each target status. */
const ALLOWED_FROM: Record<OrderStatus, readonly OrderStatus[]> = {
  awaiting_payment: [],
  paid: ['awaiting_payment', 'failed', 'expired'],
  download_confirmed: ['paid'],
  credentials_issued: ['download_confirmed'],
  completed: ['credentials_issued'],
  failed: ['awaiting_payment'],
  expired: ['awaiting_payment'],
  refunded: ['paid', 'download_confirmed', 'credentials_issued', 'completed'],
};

export function allowedSourcesFor(target: OrderStatus): readonly OrderStatus[] {
  return ALLOWED_FROM[target];
}
