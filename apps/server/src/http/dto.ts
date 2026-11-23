import type { OrderDto } from '@istock/shared';
import type { Order } from '../domain/models.js';
import { invoiceTtlMs } from '../domain/order-transitions.js';

export function toOrderDto(order: Order): OrderDto {
  const isAwaitingPayment = order.status === 'awaiting_payment';
  return {
    id: order.id,
    status: order.status,
    items: order.items.map((item) => ({
      id: item.appId,
      name: item.appName,
      iconUrl: item.appIconUrl,
      priceKopecks: item.priceKopecks,
      discountKopecks: item.discountKopecks,
    })),
    subtotalKopecks: order.subtotalKopecks,
    discountKopecks: order.discountKopecks,
    amountKopecks: order.amountKopecks,
    paymentMethod: order.paymentMethod,
    // The payment link is only useful while the order is unpaid.
    paymentUrl: isAwaitingPayment ? order.paymentUrl : null,
    expiresAt: isAwaitingPayment ? new Date(order.createdAt.getTime() + invoiceTtlMs(order.paymentMethod)).toISOString() : null,
    createdAt: order.createdAt.toISOString(),
    deliveryExpiresAt: order.deliveryExpiresAt?.toISOString() ?? null,
    isCodeReceived: order.codeReceivedAt !== null || order.status === 'completed',
    paidAt: order.paidAt?.toISOString() ?? null,
    completedAt: order.completedAt?.toISOString() ?? null,
  };
}
