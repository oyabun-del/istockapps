import { beforeEach, describe, expect, it } from 'vitest';
import type { Order } from '../domain/models.js';
import { BUYER, OTHER_USER, createTestContext, type TestContext } from '../test/fixtures.js';
import { SalesStatsService } from './sales-stats-service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

let ctx: TestContext;
let service: SalesStatsService;

beforeEach(() => {
  // The fixture clock starts at 2026-10-14 12:00 UTC, 15:00 in Moscow.
  ctx = createTestContext();
  service = new SalesStatsService({
    stats: ctx.repos.stats,
    checkout: ctx.checkout,
    timeZone: 'Europe/Moscow',
    now: ctx.clock.now,
  });
});

async function buy(appIds: readonly string[], user = BUYER, isSandbox = false, promoCode?: string): Promise<Order> {
  const created = await ctx.orders.createOrder(user, { appIds: [...appIds], paymentMethod: 'SBP', promoCode });
  const payment = ctx.payments.setStatus(created.paymentId as string, 'PAID');
  if (!payment) throw new Error('payment missing');
  await ctx.orders.handlePaymentWebhook(created.paymentOrderId, { ...payment, isSandbox });
  return (await ctx.repos.orders.findById(created.id)) as Order;
}

async function refund(order: Order): Promise<void> {
  await ctx.orders.handlePaymentWebhook(order.paymentOrderId, {
    paymentId: order.paymentId as string,
    status: 'REFUNDED',
    amountKopecks: order.amountKopecks,
    isSandbox: false,
  });
}

describe('SalesStatsService', () => {
  it('says there were no sales and shows the payments mode', async () => {
    const text = await service.reportText('today', '📊 Статистика');

    expect(text).toContain('📊 Статистика: <b>сегодня, 14 октября</b>');
    expect(text).toContain('Оплаченных заказов нет.');
    expect(text).toContain('📝 Создано заказов: 0');
    expect(text).toContain('💳 Приём оплат: 🟢 открыт для всех');
  });

  it('sums the paid orders of the period', async () => {
    await buy(['sberbank']);
    await buy(['tbank', 'alfabank', 'minecraft'], OTHER_USER);
    await ctx.orders.createOrder(BUYER, { appIds: ['canva'], paymentMethod: 'SBP' });

    const text = await service.reportText('today', '📊 Статистика');

    expect(text).toContain('💰 Выручка: <b>746 ₽</b>');
    expect(text).toContain('🛒 Оплачено: <b>2 заказа</b>, 4 приложения');
    expect(text).toContain('🧾 Средний чек: 373 ₽');
    expect(text).toContain('🏷 Скидки: 300 ₽');
    expect(text).toContain('👥 Покупателей: 2');
    expect(text).toContain('📝 Создано заказов: 3 (67% оплачено)');
    expect(text).toContain('🙋 Новых пользователей: 2');
    // Ties go alphabetically.
    expect(text).toContain('🏆 <b>Топ приложений</b>\n1. Альфа-Банк — 1\n2. СберБанк Онлайн — 1');
  });

  it('keeps test payments and refunds out of the revenue', async () => {
    await buy(['sberbank'], BUYER, true);
    await refund(await buy(['tbank']));
    await buy(['canva']);

    const text = await service.reportText('today', '📊 Статистика');

    expect(text).toContain('🛒 Оплачено: <b>1 заказ</b>, 1 приложение');
    expect(text).toContain('↩️ Возвраты: 1 на ');
    expect(text).toContain('🧪 Тестовые платежи: 1 на 349 ₽ (не в выручке)');
  });

  it('counts orders let through by a promo code', async () => {
    await ctx.repos.promoCodes.create({ code: 'IOS-REVIEW', maxApps: 5, createdBy: 111 });
    await ctx.checkout.setMode('promo');
    await buy(['sberbank'], BUYER, false, 'IOS-REVIEW');

    const text = await service.reportText('today', '📊 Статистика');

    expect(text).toContain('🎟 По промокоду: 1 заказ');
    expect(text).toContain('💳 Приём оплат: 🟡 только по промокоду');
  });

  it('separates yesterday from today by Moscow days', async () => {
    await buy(['sberbank']);
    ctx.clock.advance(DAY_MS);
    await buy(['tbank']);

    const yesterday = await service.reportText('yesterday', '📊 Статистика');
    const week = await service.reportText('week', '📊 Статистика');

    expect(yesterday).toContain('вчера, 14 октября');
    expect(yesterday).toContain('1. СберБанк Онлайн — 1');
    expect(yesterday).not.toContain('Т-Банк');
    expect(week).toContain('7 дней, с 9 октября');
    expect(week).toContain('🛒 Оплачено: <b>2 заказа</b>');
  });

  it('puts period buttons under the report and marks the shown one', async () => {
    const view = await service.statsView('week');

    expect(view.keyboard.flat().map((button) => button.text)).toEqual([
      'Сегодня',
      'Вчера',
      '• 7 дней',
      '30 дней',
      'Месяц',
      'Всё время',
    ]);
    expect(view.keyboard[0]?.[2]).toMatchObject({ kind: 'callback', data: 'stats:week' });
  });
});
