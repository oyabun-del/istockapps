import { beforeEach, describe, expect, it } from 'vitest';
import type { Order } from '../domain/models.js';
import { INVOICE_TTL_MS } from '../domain/order-transitions.js';
import { BUYER, OTHER_USER, createTestContext, type TestContext } from '../test/fixtures.js';
import { CheckoutGate, PAYMENTS_MODE_KEY } from './checkout-gate.js';

const ADMIN_ID = 111;
const TWO_APPS = ['sberbank', 'tbank'];
const THREE_APPS = ['alfabank', 'vtb-invest', 'minecraft'];

let ctx: TestContext;

beforeEach(() => {
  ctx = createTestContext();
});

async function addPromo(code = 'IOS-REVIEW', maxApps = 5) {
  const promo = await ctx.repos.promoCodes.create({ code, maxApps, createdBy: ADMIN_ID });
  if (!promo) throw new Error('promo not created');
  return promo;
}

function order(appIds: readonly string[], promoCode?: string, user = BUYER): Promise<Order> {
  return ctx.orders.createOrder(user, { appIds: [...appIds], paymentMethod: 'SBP', promoCode });
}

async function pay(created: Order, isSandbox = false): Promise<Order> {
  const payment = ctx.payments.setStatus(created.paymentId as string, 'PAID');
  if (!payment) throw new Error('payment missing');
  await ctx.orders.handlePaymentWebhook(created.paymentOrderId, { ...payment, isSandbox });
  const paid = await ctx.repos.orders.findById(created.id);
  if (!paid) throw new Error('order missing');
  return paid;
}

describe('CheckoutGate modes', () => {
  it('keeps payments open to everyone until an admin changes the mode', async () => {
    expect(await ctx.checkout.getMode()).toBe('open');

    const created = await order(['sberbank']);

    expect(created.status).toBe('awaiting_payment');
    expect(created.promoCodeId).toBeNull();
  });

  it('ignores a promo code while payments are open to everyone', async () => {
    const created = await order(['sberbank'], 'NO-SUCH-CODE');

    expect(created.promoCodeId).toBeNull();
  });

  it('falls back to open when the saved mode is unknown', async () => {
    await ctx.repos.settings.set(PAYMENTS_MODE_KEY, 'half-open');

    expect(await ctx.checkout.getMode()).toBe('open');
  });

  it('refuses every new order while payments are closed, promo code or not', async () => {
    await addPromo();
    await ctx.checkout.setMode('closed');

    await expect(order(['sberbank'])).rejects.toMatchObject({ code: 'PAYMENTS_CLOSED' });
    await expect(order(['sberbank'], 'IOS-REVIEW')).rejects.toMatchObject({ code: 'PAYMENTS_CLOSED' });
  });

  it('does not hand out an open invoice again once payments are closed', async () => {
    await order(['sberbank']);
    await ctx.checkout.setMode('closed');

    await expect(order(['sberbank'])).rejects.toMatchObject({ code: 'PAYMENTS_CLOSED' });
  });

  it('still honours a payment for an invoice opened before payments were closed', async () => {
    const created = await order(['sberbank']);
    await ctx.checkout.setMode('closed');

    expect((await pay(created)).status).toBe('paid');
  });

  it('asks for a promo code while payments are open by promo code only', async () => {
    await ctx.checkout.setMode('promo');

    await expect(order(['sberbank'])).rejects.toMatchObject({
      code: 'PAYMENTS_CLOSED',
      message: 'Сейчас оплата доступна только по промокоду',
    });
  });
});

describe('CheckoutGate promo codes', () => {
  beforeEach(async () => {
    await ctx.checkout.setMode('promo');
  });

  it('lets an order through a valid code, whatever its case, and remembers the code', async () => {
    const promo = await addPromo();

    const created = await order(TWO_APPS, 'ios-review');

    expect(created.promoCodeId).toBe(promo.id);
    expect(ctx.repos.orderEvents.events.find((event) => event.type === 'created')?.data).toMatchObject({
      promo: 'IOS-REVIEW',
    });
  });

  it('rejects unknown, malformed and disabled codes', async () => {
    await addPromo();
    await ctx.repos.promoCodes.disable('IOS-REVIEW', ctx.clock.now());

    for (const code of ['IOS-REVIEW', 'UNKNOWN', 'no', 'код!']) {
      await expect(order(['sberbank'], code)).rejects.toMatchObject({ code: 'PROMO_INVALID' });
      await expect(ctx.checkout.checkPromo(code)).rejects.toMatchObject({ code: 'PROMO_INVALID' });
    }
  });

  it('covers five apps in total, across buyers and orders', async () => {
    await addPromo();
    await pay(await order(THREE_APPS, 'IOS-REVIEW'));

    await expect(order(['sberbank', 'tbank', 'canva'], 'IOS-REVIEW', OTHER_USER)).rejects.toMatchObject({
      code: 'PROMO_LIMIT_REACHED',
      message: 'По промокоду можно оплатить ещё 2 приложения. Уберите лишние из корзины.',
    });
    await pay(await order(TWO_APPS, 'IOS-REVIEW', OTHER_USER));

    expect((await ctx.checkout.checkPromo('IOS-REVIEW')).appsLeft).toBe(0);
    await expect(order(['canva'], 'IOS-REVIEW')).rejects.toMatchObject({
      code: 'PROMO_LIMIT_REACHED',
      message: 'Промокод уже использован полностью',
    });
  });

  it('holds the apps of an unpaid order until its invoice expires', async () => {
    await addPromo('HOLD-1', 3);
    await order(THREE_APPS, 'HOLD-1');

    expect((await ctx.checkout.checkPromo('HOLD-1')).appsLeft).toBe(0);

    ctx.clock.advance(INVOICE_TTL_MS + 1);
    expect((await ctx.checkout.checkPromo('HOLD-1')).appsLeft).toBe(3);
  });

  it('keeps holding the apps of a cancelled order while its invoice can still be paid', async () => {
    await addPromo('HOLD-1', 3);
    const created = await order(THREE_APPS, 'HOLD-1');
    await ctx.orders.cancelOrder(BUYER.id, created.id);

    expect((await ctx.checkout.checkPromo('HOLD-1')).appsLeft).toBe(0);
  });

  it('gives the apps of a refunded order back to the code', async () => {
    await addPromo('REFUND', 2);
    const paid = await pay(await order(TWO_APPS, 'REFUND'));
    ctx.payments.setStatus(paid.paymentId as string, 'REFUNDED');
    await ctx.orders.handlePaymentWebhook(paid.paymentOrderId, {
      paymentId: paid.paymentId as string,
      status: 'REFUNDED',
      amountKopecks: paid.amountKopecks,
      isSandbox: false,
    });

    expect((await ctx.checkout.checkPromo('REFUND')).appsLeft).toBe(2);
  });

  it('never lets two buyers at once overrun the limit', async () => {
    await addPromo('RACE-1', 5);

    const results = await Promise.allSettled([
      order(THREE_APPS, 'RACE-1', BUYER),
      order(['sberbank', 'tbank', 'canva'], 'RACE-1', OTHER_USER),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'PROMO_LIMIT_REACHED' },
    });
    expect((await ctx.checkout.checkPromo('RACE-1')).appsLeft).toBe(2);
  });

  it('reuses the open invoice of the same apps and code without holding more apps', async () => {
    await addPromo('REUSE-1', 3);
    const first = await order(TWO_APPS, 'REUSE-1');

    const second = await order(TWO_APPS, 'REUSE-1');

    expect(second.id).toBe(first.id);
    expect((await ctx.checkout.checkPromo('REUSE-1')).appsLeft).toBe(1);
  });
});

describe('sandbox payments', () => {
  it('marks an order paid with a test payment', async () => {
    expect((await pay(await order(['sberbank']), true)).isSandbox).toBe(true);
    expect((await pay(await order(['tbank']), false)).isSandbox).toBe(false);
  });
});

describe('fake payments with real delivery', () => {
  function fakeGate() {
    return new CheckoutGate({ repos: ctx.repos, isOpenModeAllowed: false, now: ctx.clock.now });
  }

  it('works by promo code only, even when nothing was switched or "open" was saved earlier', async () => {
    expect(await fakeGate().getMode()).toBe('promo');

    await ctx.repos.settings.set(PAYMENTS_MODE_KEY, 'open');
    expect(await fakeGate().getMode()).toBe('promo');
  });

  it('refuses to open payments to everyone and keeps closed working', async () => {
    const gate = fakeGate();

    await expect(gate.setMode('open')).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await gate.setMode('closed');
    expect(await gate.getMode()).toBe('closed');
    await expect(gate.authorize('ANY-CODE')).rejects.toMatchObject({ code: 'PAYMENTS_CLOSED' });
  });

  it('asks every buyer for a promo code', async () => {
    await expect(fakeGate().authorize(undefined)).rejects.toMatchObject({ code: 'PAYMENTS_CLOSED' });
  });
});
