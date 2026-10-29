import { formatRub, type PaymentMethod } from '@istock/shared';
import type { Order, User } from '../domain/models.js';
import { escapeHtml } from '../lib/html.js';
import type { MessageButton } from './notification-service.js';

/** Telegram HTML for the admins' chats plus an optional button under it. */
export interface AdminMessage {
  html: string;
  button?: MessageButton;
}

const METHOD_LABELS: Record<PaymentMethod, string> = {
  SBP: 'СБП',
  CARD: 'Карта',
  CRYPTO: 'Крипта (USDT)',
};

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

/** "меньше минуты", "6 мин", "2 ч 5 мин", "1 д 3 ч": the two largest units are enough for a glance. */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(Math.max(0, ms) / MS_PER_MINUTE);
  if (totalMinutes === 0) return 'меньше минуты';
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  const totalHours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  if (totalHours === 0) return `${minutes} мин`;
  const hours = totalHours % HOURS_PER_DAY;
  const days = Math.floor(totalHours / HOURS_PER_DAY);
  if (days === 0) return minutes > 0 ? `${hours} ч ${minutes} мин` : `${hours} ч`;
  return hours > 0 ? `${days} д ${hours} ч` : `${days} д`;
}

function describeUser(user: User | null, userId: number): string {
  if (!user) return `id <code>${userId}</code>`;
  const name = escapeHtml([user.firstName, user.lastName].filter(Boolean).join(' '));
  const username = user.username ? ` @${escapeHtml(user.username)}` : '';
  return `<a href="tg://user?id=${user.id}">${name}</a>${username} · id <code>${user.id}</code>`;
}

/**
 * A t.me link, never tg://user?id: Telegram rejects the whole message when the buyer's privacy
 * settings forbid such a button.
 */
function chatButton(user: User | null): MessageButton | undefined {
  if (!user?.username) return undefined;
  return { text: '💬 Написать покупателю', url: `https://t.me/${encodeURIComponent(user.username)}` };
}

function appsQuote(order: Pick<Order, 'items'>): string {
  return `<blockquote>${order.items.map((item) => escapeHtml(item.appName)).join('\n')}</blockquote>`;
}

function joinLines(lines: readonly (string | null)[]): string {
  return lines.filter((line): line is string => line !== null).join('\n');
}

export function purchaseMessage(order: Order, user: User | null, isSandbox: boolean): AdminMessage {
  const html = joinLines([
    `🛒 <b>Новая покупка</b> · заказ <b>#${order.id}</b>`,
    appsQuote(order),
    `💰 <b>${formatRub(order.amountKopecks)}</b> · ${METHOD_LABELS[order.paymentMethod]}`,
    order.discountKopecks > 0 ? `🏷 Скидка: <b>${formatRub(order.discountKopecks)}</b>` : null,
    order.promoCodeId !== null ? '🎟 По промокоду' : null,
    `👤 ${describeUser(user, order.userId)}`,
    isSandbox ? '🧪 <i>Тестовый платёж, в выручку не входит</i>' : null,
  ]);
  return { html, button: chatButton(user) };
}

export function activationMessage(order: Order, user: User | null): AdminMessage {
  const took =
    order.paidAt && order.completedAt ? formatDuration(order.completedAt.getTime() - order.paidAt.getTime()) : null;
  const html = joinLines([
    `✅ <b>Активация завершена</b> · заказ <b>#${order.id}</b>`,
    appsQuote(order),
    `👤 ${describeUser(user, order.userId)}`,
    took ? `⏱ От оплаты до активации: <b>${took}</b>` : null,
  ]);
  return { html, button: chatButton(user) };
}
