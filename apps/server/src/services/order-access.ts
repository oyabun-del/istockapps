import type { Order } from '../domain/models.js';
import { AppError } from '../lib/app-error.js';
import type { OrderRepository } from '../repositories/repositories.js';

/** Loads an order and hides foreign orders behind NOT_FOUND (no id enumeration). */
export async function getOwnedOrder(orders: OrderRepository, userId: number, orderId: number): Promise<Order> {
  const order = await orders.findById(orderId);
  if (!order || order.userId !== userId) throw new AppError('NOT_FOUND', 'Заказ не найден');
  return order;
}
