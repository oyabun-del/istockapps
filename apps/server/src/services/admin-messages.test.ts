import { describe, expect, it } from 'vitest';
import type { Order } from '../domain/models.js';
import { BUYER, OTHER_USER } from '../test/fixtures.js';
import { activationMessage, formatDuration, purchaseMessage } from './admin-messages.js';

const MINUTE_MS = 60_000;
const PAID_AT = new Date('2026-10-14T12:00:00Z');

function order(patch: Partial<Order> = {}): Order {
  return {
    id: 7,
    paymentOrderId: 'p-7',
    userId: BUYER.id,
    items: [
      { appId: 'sberbank', appName: 'СберБанк Онлайн', appIconUrl: '', priceKopecks: 59_900, discountKopecks: 0 },
      { appId: 'tbank', appName: 'Т-Банк <beta>', appIconUrl: '', priceKopecks: 59_900, discountKopecks: 0 },
    ],
    subtotalKopecks: 119_800,
    discountKopecks: 0,
    amountKopecks: 119_800,
    paymentMethod: 'SBP',
    status: 'paid',
    paymentId: null,
    paymentUrl: null,
    paymentSyncedAt: null,
    isSandbox: false,
    promoCodeId: null,
    deliveryRef: null,
    deliveryExpiresAt: null,
    codeReceivedAt: null,
    paidAt: PAID_AT,
    completedAt: null,
    createdAt: PAID_AT,
    ...patch,
  };
}

describe('purchaseMessage', () => {
  it('quotes every app on its own line with escaped names', () => {
    const { html } = purchaseMessage(order(), BUYER, false);

    expect(html).toContain('🛒 <b>Новая покупка</b> · заказ <b>#7</b>');
    expect(html).toContain('<blockquote>СберБанк Онлайн\nТ-Банк &lt;beta&gt;</blockquote>');
    expect(html).toContain('💰 <b>1 198 ₽</b> · СБП');
  });

  it('shows the discount, promo code and sandbox marks only when they apply', () => {
    const plain = purchaseMessage(order(), BUYER, false).html;
    expect(plain).not.toContain('Скидка');
    expect(plain).not.toContain('промокоду');
    expect(plain).not.toContain('Тестовый');

    const marked = purchaseMessage(order({ discountKopecks: 30_000, promoCodeId: 3 }), BUYER, true).html;
    expect(marked).toContain('🏷 Скидка: <b>300 ₽</b>');
    expect(marked).toContain('🎟 По промокоду');
    expect(marked).toContain('🧪 <i>Тестовый платёж, в выручку не входит</i>');
  });

  it('links the buyer and offers a chat button when the buyer has a username', () => {
    const { html, button } = purchaseMessage(order(), { ...BUYER, firstName: 'Иван <b>' }, false);

    expect(html).toContain('👤 <a href="tg://user?id=42">Иван &lt;b&gt;</a> @ivan · id <code>42</code>');
    expect(button).toEqual({ text: '💬 Написать покупателю', url: 'https://t.me/ivan' });
  });

  it('falls back to the bare id without a button when the buyer is unknown or has no username', () => {
    expect(purchaseMessage(order(), null, false)).toMatchObject({ button: undefined });
    expect(purchaseMessage(order(), null, false).html).toContain('👤 id <code>42</code>');
    expect(purchaseMessage(order(), OTHER_USER, false).button).toBeUndefined();
  });

  it('labels payment methods', () => {
    expect(purchaseMessage(order({ paymentMethod: 'CRYPTO' }), BUYER, false).html).toContain('Крипта (USDT)');
  });
});

describe('activationMessage', () => {
  it('reports the apps, the buyer and the time from payment to activation', () => {
    const completedAt = new Date(PAID_AT.getTime() + 6 * MINUTE_MS);
    const { html, button } = activationMessage(order({ status: 'completed', completedAt }), BUYER);

    expect(html).toContain('✅ <b>Активация завершена</b> · заказ <b>#7</b>');
    expect(html).toContain('<blockquote>СберБанк Онлайн\nТ-Банк &lt;beta&gt;</blockquote>');
    expect(html).toContain('@ivan');
    expect(html).toContain('⏱ От оплаты до активации: <b>6 мин</b>');
    expect(button?.url).toBe('https://t.me/ivan');
  });

  it('leaves the duration out when a timestamp is missing', () => {
    expect(activationMessage(order({ paidAt: null, completedAt: new Date() }), BUYER).html).not.toContain('⏱');
  });
});

describe('formatDuration', () => {
  it.each([
    [0, 'меньше минуты'],
    [59_000, 'меньше минуты'],
    [MINUTE_MS, '1 мин'],
    [59 * MINUTE_MS, '59 мин'],
    [60 * MINUTE_MS, '1 ч'],
    [125 * MINUTE_MS, '2 ч 5 мин'],
    [(24 * 60 + 90) * MINUTE_MS, '1 д 1 ч'],
    [-MINUTE_MS, 'меньше минуты'],
  ])('%i ms → %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});
