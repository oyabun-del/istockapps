import type { OrderDto } from '@istock/shared';
import type { Order } from '../domain/models.js';

export function toOrderDto(order: Order): OrderDto {
  return {
    id: order.id,
    status: order.status,
    app: { id: order.appId, name: order.appName, iconUrl: order.appIconUrl },
    amountKopecks: order.amountKopecks,
    paymentMethod: order.paymentMethod,
    // The payment link is only useful while the order is unpaid.
    paymentUrl: order.status === 'awaiting_payment' ? order.paymentUrl : null,
    createdAt: order.createdAt.toISOString(),
    paidAt: order.paidAt?.toISOString() ?? null,
    completedAt: order.completedAt?.toISOString() ?? null,
  };
}
