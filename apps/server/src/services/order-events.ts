import { getErrorMessage } from '../lib/app-error.js';
import type { Logger } from '../lib/logger.js';
import type { OrderEventRepository } from '../repositories/repositories.js';

/**
 * Audit trail after a committed transition: a failure is logged, never propagated,
 * because a retry would skip the transition and the buyer would get an error for nothing.
 */
export async function recordOrderEvent(
  events: OrderEventRepository,
  logger: Logger,
  orderId: number,
  type: string,
  data?: Record<string, unknown>,
): Promise<void> {
  try {
    await events.add(orderId, type, data);
  } catch (error: unknown) {
    logger.error({ orderId, type, err: getErrorMessage(error) }, 'Failed to record order event');
  }
}
