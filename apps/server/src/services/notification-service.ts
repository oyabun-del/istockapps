import { formatRub, type PaymentMethod } from '@istock/shared';
import type { Order, User } from '../domain/models.js';
import { describeApps } from '../domain/order-items.js';
import { getErrorMessage } from '../lib/app-error.js';
import { escapeHtml } from '../lib/html.js';
import type { Logger } from '../lib/logger.js';

export interface MessageButton {
  text: string;
  /** Opens the Mini App at this URL. */
  webAppUrl?: string;
  url?: string;
}

/** Thin port over the Telegram Bot API (implemented with grammY). */
export interface MessageSender {
  send(chatId: number, html: string, button?: MessageButton): Promise<void>;
}

const METHOD_LABELS: Record<PaymentMethod, string> = {
  SBP: 'СБП',
  CARD: 'Карта',
  CRYPTO: 'Крипта (USDT)',
};

function describeUser(user: User | null, userId: number): string {
  if (!user) return `id <code>${userId}</code>`;
  const name = escapeHtml([user.firstName, user.lastName].filter(Boolean).join(' '));
  const username = user.username ? ` @${escapeHtml(user.username)}` : '';
  return `<a href="tg://user?id=${user.id}">${name}</a>${username} (id <code>${user.id}</code>)`;
}

export interface NotificationServiceDeps {
  sender: MessageSender;
  adminIds: readonly number[];
  webAppUrl: string;
  logger: Logger;
}

export class NotificationService {
  constructor(private readonly deps: NotificationServiceDeps) {}

  async purchaseCompleted(order: Order, user: User | null, isSandbox: boolean): Promise<void> {
    const lines = [
      `🛒 <b>Новая покупка</b>${isSandbox ? ' <i>(тестовый платёж)</i>' : ''}`,
      `Заказ <b>#${order.id}</b>: ${escapeHtml(describeApps(order))}`,
      `Сумма: <b>${formatRub(order.amountKopecks)}</b> (${METHOD_LABELS[order.paymentMethod]})`,
      order.discountKopecks > 0 ? `Скидка: <b>${formatRub(order.discountKopecks)}</b>` : null,
      `Покупатель: ${describeUser(user, order.userId)}`,
    ];
    await this.notifyAdmins(lines.filter((line) => line !== null).join('\n'));
  }

  async orderRefunded(order: Order): Promise<void> {
    await this.notifyAdmins(
      `↩️ <b>Возврат</b>\nЗаказ <b>#${order.id}</b>: ${escapeHtml(describeApps(order))}, ${formatRub(order.amountKopecks)}`,
    );
  }

  async paymentAmountMismatch(order: Order, receivedKopecks: number): Promise<void> {
    await this.notifyAdmins(
      `⚠️ <b>Сумма оплаты не совпала</b>\nЗаказ <b>#${order.id}</b>: ожидали ${formatRub(order.amountKopecks)}, ` +
        `пришло ${formatRub(receivedKopecks)}. Заказ не выдан, проверьте вручную.`,
    );
  }

  async notifyBuyerPaid(order: Order): Promise<void> {
    try {
      await this.deps.sender.send(
        order.userId,
        `✅ Оплата получена: <b>${escapeHtml(describeApps(order))}</b>\n` +
          (order.items.length > 1
            ? 'Откройте заказ, чтобы скачать приложения и активировать их.'
            : 'Откройте заказ, чтобы скачать приложение и активировать его.'),
        { text: `Открыть заказ #${order.id}`, webAppUrl: `${this.deps.webAppUrl}#/orders/${order.id}` },
      );
    } catch (error: unknown) {
      // The buyer may have blocked the bot; the order page still works.
      this.deps.logger.warn({ orderId: order.id, err: getErrorMessage(error) }, 'Failed to notify buyer');
    }
  }

  /**
   * Sends to every admin (but `exceptId`); one failing admin never blocks the others.
   * Returns how many admins got the message.
   */
  async notifyAdmins(html: string, exceptId?: number): Promise<number> {
    const adminIds = this.deps.adminIds.filter((id) => id !== exceptId);
    const results = await Promise.allSettled(adminIds.map((id) => this.deps.sender.send(id, html)));
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.deps.logger.error(
          { adminId: adminIds[index], err: getErrorMessage(result.reason) },
          'Failed to notify admin (has the admin pressed /start in the bot?)',
        );
      }
    });
    return results.filter((result) => result.status === 'fulfilled').length;
  }
}
