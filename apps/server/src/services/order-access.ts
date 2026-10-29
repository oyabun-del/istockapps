import type { Order, User } from '../domain/models.js';
import { AppError, getErrorMessage } from '../lib/app-error.js';
import type { Logger } from '../lib/logger.js';
import type { OrderRepository, UserRepository } from '../repositories/repositories.js';

/** Loads an order and hides foreign orders behind NOT_FOUND (no id enumeration). */
export async function getOwnedOrder(orders: OrderRepository, userId: number, orderId: number): Promise<Order> {
  const order = await orders.findById(orderId);
  if (!order || order.userId !== userId) throw new AppError('NOT_FOUND', 'Заказ не найден');
  return order;
}

/** The buyer for an admin notification; null if the lookup fails, so the notice still goes out with the bare id. */
export async function findBuyer(users: UserRepository, logger: Logger, userId: number): Promise<User | null> {
  try {
    return await users.findById(userId);
  } catch (error: unknown) {
    logger.error({ userId, err: getErrorMessage(error) }, 'Failed to load buyer for notification');
    return null;
  }
}
