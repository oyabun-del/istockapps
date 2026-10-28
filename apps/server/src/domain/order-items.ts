import type { Order } from './models.js';

/** "СберБанк Онлайн, Т-Банк": names of the order's apps for messages and payment descriptions. */
export function describeApps(order: Pick<Order, 'items'>): string {
  return order.items.map((item) => item.appName).join(', ');
}
