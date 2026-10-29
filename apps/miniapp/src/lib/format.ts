const SECONDS_PER_MINUTE = 60;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const COMPACT_FROM = 10_000;

const TIME = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const DAY_MONTH = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const COMPACT = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 });

import { pluralRu } from '@istock/shared';

export { pluralRu, type PluralForms } from '@istock/shared';

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "Сегодня, 14:20", "Вчера, 09:05", "12 мая", or with the year when it is not the current one. */
export function formatOrderDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const daysAgo = Math.round((startOfDay(now) - startOfDay(date)) / MS_PER_DAY);
  if (daysAgo === 0) return `Сегодня, ${TIME.format(date)}`;
  if (daysAgo === 1) return `Вчера, ${TIME.format(date)}`;
  const format = date.getFullYear() === now.getFullYear() ? DAY_MONTH : DAY_MONTH_YEAR;
  return format.format(date).replace(/\s?г\.$/, '');
}

/** "18:30" today, otherwise "15 октября, 18:30". */
export function formatDeadline(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const time = TIME.format(date);
  return startOfDay(date) === startOfDay(now) ? time : `${DAY_MONTH.format(date)}, ${time}`;
}

/** 886 → "14:46". */
export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  return `${minutes}:${String(seconds % SECONDS_PER_MINUTE).padStart(2, '0')}`;
}

/** "СберБанк Онлайн" for one app, "СберБанк Онлайн и ещё 2" for several. */
export function formatOrderTitle(items: readonly { name: string }[]): string {
  const [first, ...rest] = items;
  if (!first) return 'Заказ';
  return rest.length > 0 ? `${first.name} и ещё ${rest.length}` : first.name;
}

export function formatSubscribers(count: number): string {
  if (count >= COMPACT_FROM) return `${COMPACT.format(count)} подписчиков`;
  return `${count} ${pluralRu(count, ['подписчик', 'подписчика', 'подписчиков'])}`;
}
