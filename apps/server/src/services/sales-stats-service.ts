import { formatRub, pluralRu } from '@istock/shared';
import type { InlineButton, Keyboard, SalesSummary } from '../domain/models.js';
import { periodRange, type StatsPeriod } from '../domain/stats-period.js';
import { escapeHtml } from '../lib/html.js';
import type { StatsRepository } from '../repositories/repositories.js';
import { PAYMENTS_MODE_LABELS, type CheckoutGate } from './checkout-gate.js';

export const STATS_CALLBACK_PREFIX = 'stats:';
/** Callback data of the period buttons under a report. */
export const STATS_CALLBACK_PATTERN = /^stats:(today|yesterday|week|days30|month|all)$/;

const PERCENT = 100;

const BUTTON_LABELS: Record<StatsPeriod, string> = {
  today: 'Сегодня',
  yesterday: 'Вчера',
  week: '7 дней',
  days30: '30 дней',
  month: 'Месяц',
  all: 'Всё время',
};

const BUTTON_ROWS: readonly (readonly StatsPeriod[])[] = [
  ['today', 'yesterday', 'week'],
  ['days30', 'month', 'all'],
];

export interface StatsView {
  html: string;
  keyboard: Keyboard;
}

export interface SalesStatsDeps {
  stats: StatsRepository;
  checkout: Pick<CheckoutGate, 'getMode'>;
  /** IANA time zone the shop's days are counted in. */
  timeZone: string;
  now?: () => Date;
}

const count = (value: number, forms: readonly [string, string, string]) => `${value} ${pluralRu(value, forms)}`;

function salesLines(summary: SalesSummary): string[] {
  if (summary.paidOrders === 0) return ['Оплаченных заказов нет.'];
  const averageKopecks = Math.round(summary.revenueKopecks / summary.paidOrders);
  return [
    `💰 Выручка: <b>${formatRub(summary.revenueKopecks)}</b>`,
    `🛒 Оплачено: <b>${count(summary.paidOrders, ['заказ', 'заказа', 'заказов'])}</b>, ` +
      `${count(summary.appsSold, ['приложение', 'приложения', 'приложений'])}`,
    `🧾 Средний чек: ${formatRub(averageKopecks)}`,
    summary.discountKopecks > 0 ? `🏷 Скидки: ${formatRub(summary.discountKopecks)}` : null,
    `👥 Покупателей: ${summary.buyers}`,
    summary.promoOrders > 0 ? `🎟 По промокоду: ${count(summary.promoOrders, ['заказ', 'заказа', 'заказов'])}` : null,
  ].filter((line): line is string => line !== null);
}

function funnelLines(summary: SalesSummary): string[] {
  const conversion =
    summary.createdOrders > 0 ? ` (${Math.round((summary.paidOrders / summary.createdOrders) * PERCENT)}% оплачено)` : '';
  return [
    `📝 Создано заказов: ${summary.createdOrders}${conversion}`,
    `🙋 Новых пользователей: ${summary.newUsers}`,
    summary.refunds > 0 ? `↩️ Возвраты: ${summary.refunds} на ${formatRub(summary.refundedKopecks)}` : null,
    summary.sandboxOrders > 0
      ? `🧪 Тестовые платежи: ${summary.sandboxOrders} на ${formatRub(summary.sandboxKopecks)} (не в выручке)`
      : null,
  ].filter((line): line is string => line !== null);
}

function topLines(summary: SalesSummary): string[] {
  if (summary.topApps.length === 0) return [];
  return [
    '',
    '🏆 <b>Топ приложений</b>',
    ...summary.topApps.map((app, index) => `${index + 1}. ${escapeHtml(app.name)} — ${app.count}`),
  ];
}

/** Sales reports for admins, answered as Telegram HTML. */
export class SalesStatsService {
  private readonly now: () => Date;
  private readonly dayMonth: Intl.DateTimeFormat;

  constructor(private readonly deps: SalesStatsDeps) {
    this.now = deps.now ?? (() => new Date());
    this.dayMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: deps.timeZone });
  }

  /** The /stats message: the report and the period buttons, the shown period marked. */
  async statsView(period: StatsPeriod): Promise<StatsView> {
    return { html: await this.reportText(period, '📊 Статистика'), keyboard: this.periodKeyboard(period) };
  }

  async reportText(period: StatsPeriod, heading: string): Promise<string> {
    const now = this.now();
    const [summary, mode] = await Promise.all([
      this.deps.stats.summary(periodRange(period, now, this.deps.timeZone)),
      this.deps.checkout.getMode(),
    ]);
    return [
      `${heading}: <b>${this.periodTitle(period, now)}</b>`,
      '',
      ...salesLines(summary),
      ...funnelLines(summary),
      ...topLines(summary),
      '',
      `💳 Приём оплат: ${PAYMENTS_MODE_LABELS[mode]}`,
    ].join('\n');
  }

  private periodTitle(period: StatsPeriod, now: Date): string {
    const range = periodRange(period, now, this.deps.timeZone);
    const since = range.from ? this.dayMonth.format(range.from) : '';
    switch (period) {
      case 'today':
        return `сегодня, ${since}`;
      case 'yesterday':
        return `вчера, ${since}`;
      case 'week':
        return `7 дней, с ${since}`;
      case 'days30':
        return `30 дней, с ${since}`;
      case 'month':
        return `этот месяц, с ${since}`;
      case 'all':
        return 'всё время';
    }
  }

  private periodKeyboard(current: StatsPeriod): Keyboard {
    return BUTTON_ROWS.map((row) =>
      row.map(
        (period): InlineButton => ({
          kind: 'callback',
          text: period === current ? `• ${BUTTON_LABELS[period]}` : BUTTON_LABELS[period],
          data: `${STATS_CALLBACK_PREFIX}${period}`,
        }),
      ),
    );
  }
}
