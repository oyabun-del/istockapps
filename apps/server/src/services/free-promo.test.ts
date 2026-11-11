import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatAppCount, type PromoKind } from '@istock/shared';
import type { Order } from '../domain/models.js';
import { PaymentProviderError } from '../providers/payment/payment-provider.js';
import { ADMIN_IDS, BUYER, OTHER_USER, createTestContext, type TestContext } from '../test/fixtures.js';

const ADMIN_ID = ADMIN_IDS[0] as number;
const TWO_APPS = ['sberbank', 'tbank'];
const THREE_APPS = ['alfabank', 'vtb-invest', 'minecraft'];

let ctx: TestContext;

beforeEach(() => {
  ctx = createTestContext();
});

async function addPromo(code = 'GIFT-2026', maxApps = 5, kind: PromoKind = 'free') {
  const promo = await ctx.repos.promoCodes.create({ code, maxApps, createdBy: ADMIN_ID, kind });
  if (!promo) throw new Error('promo not created');
  return promo;
}

function order(appIds: readonly string[], promoCode?: string, user = BUYER): Promise<Order> {
  return ctx.orders.createOrder(user, { appIds: [...appIds], paymentMethod: 'SBP', promoCode });
}

describe('free promo codes', () => {
  it('hands out the cart for free while payments are open to everyone, without opening an invoice', async () => {
    const promo = await addPromo();
    const createPayment = vi.spyOn(ctx.payments, 'createPayment');

    const created = await order(TWO_APPS, 'gift-2026');

    expect(createPayment).not.toHaveBeenCalled();
    expect(created).toMatchObject({
      status: 'paid',
      paymentMethod: 'PROMO',
      amountKopecks: 0,
      discountKopecks: created.subtotalKopecks,
      paymentId: null,
      paymentUrl: null,
      promoCodeId: promo.id,
      isSandbox: false,
    });
    expect(created.paidAt).toEqual(ctx.clock.now());
    expect(created.items.every((item) => item.discountKopecks === item.priceKopecks)).toBe(true);
  });

  it('works while payments are open by promo code only', async () => {
    await addPromo();
    await ctx.checkout.setMode('promo');

    expect((await order(['sberbank'], 'GIFT-2026')).status).toBe('paid');
  });

  it('does not work while payments are closed', async () => {
    await addPromo();
    await ctx.checkout.setMode('closed');

    await expect(order(['sberbank'], 'GIFT-2026')).rejects.toMatchObject({ code: 'PAYMENTS_CLOSED' });
  });

  it('works while the payment service is down', async () => {
    await addPromo();
    vi.spyOn(ctx.payments, 'createPayment').mockRejectedValue(new PaymentProviderError('down'));

    expect((await order(['sberbank'], 'GIFT-2026')).status).toBe('paid');
  });

  it('counts the free apps against the code and refuses a cart larger than what is left', async () => {
    await addPromo('GIFT-3', 3);
    await order(TWO_APPS, 'GIFT-3');

    expect(await ctx.checkout.checkPromo('GIFT-3')).toMatchObject({ appsLeft: 1 });
    await expect(order(THREE_APPS, 'GIFT-3', OTHER_USER)).rejects.toMatchObject({
      code: 'PROMO_LIMIT_REACHED',
      message: `По промокоду можно оплатить ещё ${formatAppCount(1)}. Уберите лишние из корзины.`,
    });
  });

  it('records the order and tells the admins and the buyer', async () => {
    await addPromo();

    const created = await order(['sberbank'], 'GIFT-2026');

    const events = ctx.repos.orderEvents.events.filter((event) => event.orderId === created.id);
    expect(events.map((event) => event.type)).toEqual(['created', 'paid']);
    expect(events[1]?.data).toMatchObject({ promo: 'GIFT-2026', free: true });
    const toAdmin = ctx.sender.sent.find((message) => message.chatId === ADMIN_ID);
    expect(toAdmin?.html).toContain('🎁 Бесплатно по промокоду <code>GIFT-2026</code>');
    expect(toAdmin?.html).not.toContain('💰');
    const toBuyer = ctx.sender.sent.find((message) => message.chatId === BUYER.id);
    expect(toBuyer?.html).toContain('🎁 Промокод применён');
  });

  it('hands out the same order again when the buyer taps twice, at once or one after another', async () => {
    await addPromo();

    const [first, second] = await Promise.all([order(TWO_APPS, 'GIFT-2026'), order(TWO_APPS, 'GIFT-2026')]);
    const third = await order([...TWO_APPS].reverse(), 'GIFT-2026');

    expect(second.id).toBe(first.id);
    expect(third.id).toBe(first.id);
    expect(await ctx.checkout.checkPromo('GIFT-2026')).toMatchObject({ appsLeft: 3 });
  });

  it('spends another code on the same apps instead of handing out the order of the first one', async () => {
    await addPromo();
    const first = await order(['sberbank'], 'GIFT-2026');
    await addPromo('GIFT-OTHER');

    const second = await order(['sberbank'], 'GIFT-OTHER');

    expect(second.id).not.toBe(first.id);
  });

  it('frees the code when the order could not be marked paid, and never hands it out as a repeat', async () => {
    await addPromo('GIFT-1', 1);
    const transition = ctx.repos.orders.transition.bind(ctx.repos.orders);
    const spy = vi
      .spyOn(ctx.repos.orders, 'transition')
      .mockImplementationOnce(async () => {
        throw new Error('db down');
      });

    await expect(order(['sberbank'], 'GIFT-1')).rejects.toThrow('db down');
    const [stuck] = await ctx.repos.orders.listByUser(BUYER.id, 1);
    expect(stuck?.status).toBe('failed');
    expect(await ctx.checkout.checkPromo('GIFT-1')).toMatchObject({ appsLeft: 1 });

    spy.mockImplementation(transition);
    const retried = await order(['sberbank'], 'GIFT-1');
    expect(retried.id).not.toBe(stuck?.id);
    expect(retried.status).toBe('paid');
  });

  it('opens a new free order for other apps', async () => {
    await addPromo();
    const first = await order(['sberbank'], 'GIFT-2026');

    const second = await order(['tbank'], 'GIFT-2026');

    expect(second.id).not.toBe(first.id);
  });

  it('never asks the payment service about a free order', async () => {
    await addPromo();
    const created = await order(['sberbank'], 'GIFT-2026');
    const getPayment = vi.spyOn(ctx.payments, 'getPayment');

    await ctx.orders.reconcilePayments();
    const read = await ctx.orders.getOrder(BUYER.id, created.id);

    expect(getPayment).not.toHaveBeenCalled();
    expect(read.status).toBe('paid');
  });

  it('opens the delivery of a free order like a paid one', async () => {
    await addPromo();
    const created = await order(['sberbank'], 'GIFT-2026');

    const delivery = await ctx.deliveryService.getDelivery(BUYER.id, created.id);

    expect(delivery.groups.length).toBeGreaterThan(0);
  });

  it('tells the cart whether a code is free', async () => {
    await addPromo('GIFT-2026', 5, 'free');
    await addPromo('IOS-REVIEW', 5, 'access');

    expect((await ctx.checkout.checkPromo('GIFT-2026')).promo.kind).toBe('free');
    expect((await ctx.checkout.checkPromo('IOS-REVIEW')).promo.kind).toBe('access');
  });
});

describe('access promo codes while payments are open to everyone', () => {
  it('takes the payment as usual and holds no apps of the code', async () => {
    await addPromo('IOS-REVIEW', 5, 'access');

    const created = await order(['sberbank'], 'IOS-REVIEW');

    expect(created).toMatchObject({ status: 'awaiting_payment', paymentMethod: 'SBP', promoCodeId: null });
    expect(await ctx.checkout.checkPromo('IOS-REVIEW')).toMatchObject({ appsLeft: 5 });
  });

  it('refuses an unknown code the buyer applied', async () => {
    await expect(order(['sberbank'], 'NO-SUCH-CODE')).rejects.toMatchObject({ code: 'PROMO_INVALID' });
  });
});
