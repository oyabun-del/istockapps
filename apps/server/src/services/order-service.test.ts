import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../lib/app-error.js';
import { ADMIN_IDS, BUYER, OTHER_USER, createPaidOrder, createTestContext, type TestContext } from '../test/fixtures.js';
import { silentLogger } from '../lib/logger.js';
import { OrderService, PAYMENT_SYNC_INTERVAL_MS } from './order-service.js';

const THREE_APPS = ['sberbank', 'tbank', 'minecraft'];
const FIVE_APPS = ['sberbank', 'tbank', 'minecraft', 'brawl-stars', 'canva'];

let ctx: TestContext;

beforeEach(() => {
  ctx = createTestContext();
});

describe('OrderService.createOrder', () => {
  it('creates an order priced from the catalog and opens a payment', async () => {
    const order = await ctx.orders.createOrder(BUYER, { appIds: ['sberbank'], paymentMethod: 'SBP' });

    expect(order).toMatchObject({
      userId: BUYER.id,
      items: [{ appId: 'sberbank', appName: 'СберБанк Онлайн', priceKopecks: 34900, discountKopecks: 0 }],
      subtotalKopecks: 34900,
      discountKopecks: 0,
      amountKopecks: 34900,
      status: 'awaiting_payment',
      paymentMethod: 'SBP',
    });
    expect(order.paymentUrl).toMatch(/\/dev\/mock-pay\//);
    expect(await ctx.repos.users.findById(BUYER.id)).not.toBeNull();
  });

  it('takes 100 ₽ off each app when three apps are bought at once', async () => {
    const order = await ctx.orders.createOrder(BUYER, { appIds: THREE_APPS, paymentMethod: 'SBP' });

    expect(order.items.map((item) => [item.appId, item.priceKopecks, item.discountKopecks])).toEqual([
      ['sberbank', 34900, 10000],
      ['tbank', 19900, 10000],
      ['minecraft', 29900, 10000],
    ]);
    expect(order).toMatchObject({ subtotalKopecks: 84700, discountKopecks: 30000, amountKopecks: 54700 });
    expect((await ctx.payments.getPayment(order.paymentId as string)).amountKopecks).toBe(54700);
  });

  it('takes 150 ₽ off each app when five apps are bought at once', async () => {
    const order = await ctx.orders.createOrder(BUYER, { appIds: FIVE_APPS, paymentMethod: 'SBP' });

    expect(order.items.every((item) => item.discountKopecks === 15000)).toBe(true);
    expect(order).toMatchObject({ subtotalKopecks: 129500, discountKopecks: 75000, amountKopecks: 54500 });
  });

  it('names the apps in the payment description', async () => {
    const createPayment = vi.spyOn(ctx.payments, 'createPayment');

    const order = await ctx.orders.createOrder(BUYER, { appIds: THREE_APPS, paymentMethod: 'SBP' });

    expect(createPayment.mock.calls[0]?.[0].description).toBe(
      `СберБанк Онлайн, Т-Банк, Minecraft, заказ #${order.id}`,
    );
  });

  it('keeps the payment description within the CISPAY limit for long app names', async () => {
    const original = ctx.catalog.getApp.bind(ctx.catalog);
    vi.spyOn(ctx.catalog, 'getApp').mockImplementation(async (id) => {
      const app = await original('sberbank');
      return app && { ...app, id, name: `Очень длинное название приложения ${id} `.repeat(3) };
    });
    const createPayment = vi.spyOn(ctx.payments, 'createPayment');
    const appIds = Array.from({ length: 10 }, (_, index) => `app-${index}`);

    const order = await ctx.orders.createOrder(BUYER, { appIds, paymentMethod: 'SBP' });

    const description = createPayment.mock.calls[0]?.[0].description ?? '';
    expect(description.length).toBeLessThanOrEqual(512);
    expect(description.endsWith(`…, заказ #${order.id}`)).toBe(true);
  });

  it('refuses the order when the total differs from what the buyer saw', async () => {
    await expect(
      ctx.orders.createOrder(BUYER, { appIds: THREE_APPS, paymentMethod: 'SBP', expectedTotalKopecks: 84700 }),
    ).rejects.toMatchObject({ code: 'PRICE_CHANGED' });
    expect(await ctx.orders.listOrders(BUYER.id)).toHaveLength(0);

    const order = await ctx.orders.createOrder(BUYER, {
      appIds: THREE_APPS,
      paymentMethod: 'SBP',
      expectedTotalKopecks: 54700,
    });
    expect(order.amountKopecks).toBe(54700);
  });

  it('rejects an order with any unknown app', async () => {
    await expect(
      ctx.orders.createOrder(BUYER, { appIds: ['sberbank', 'nope'], paymentMethod: 'SBP' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await ctx.orders.listOrders(BUYER.id)).toHaveLength(0);
  });

  it('rejects unknown apps', async () => {
    await expect(ctx.orders.createOrder(BUYER, { appIds: ['nope'], paymentMethod: 'SBP' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('rejects orders when CISPAY has SBP disabled', async () => {
    vi.spyOn(ctx.payments, 'listMethods').mockResolvedValue(['CARD', 'CRYPTO']);
    await expect(ctx.orders.createOrder(BUYER, { appIds: ['sberbank'], paymentMethod: 'SBP' })).rejects.toMatchObject({
      code: 'PAYMENT_METHOD_UNAVAILABLE',
    });
  });

  it('offers SBP only, even when CISPAY enables other methods', async () => {
    vi.spyOn(ctx.payments, 'listMethods').mockResolvedValue(['CARD', 'SBP', 'CRYPTO']);
    expect(await ctx.orders.listPaymentMethods()).toEqual(['SBP']);
  });

  it('reuses a fresh unpaid order for the same set of apps in any order', async () => {
    const first = await ctx.orders.createOrder(BUYER, { appIds: THREE_APPS, paymentMethod: 'SBP' });
    const second = await ctx.orders.createOrder(BUYER, { appIds: [...THREE_APPS].reverse(), paymentMethod: 'SBP' });

    expect(second.id).toBe(first.id);
  });

  it('does not reuse an unpaid order for a different set of apps', async () => {
    const first = await ctx.orders.createOrder(BUYER, { appIds: THREE_APPS, paymentMethod: 'SBP' });
    const subset = await ctx.orders.createOrder(BUYER, { appIds: THREE_APPS.slice(0, 2), paymentMethod: 'SBP' });
    const superset = await ctx.orders.createOrder(BUYER, { appIds: [...THREE_APPS, 'canva'], paymentMethod: 'SBP' });

    expect(new Set([first.id, subset.id, superset.id]).size).toBe(3);
  });

  it('reuses a fresh unpaid order for the same app', async () => {
    const first = await ctx.orders.createOrder(BUYER, { appIds: ['sberbank'], paymentMethod: 'SBP' });
    const second = await ctx.orders.createOrder(BUYER, { appIds: ['sberbank'], paymentMethod: 'SBP' });

    expect(second.id).toBe(first.id);
  });

  it('does not reuse an invoice that CISPAY already expired', async () => {
    const first = await ctx.orders.createOrder(BUYER, { appIds: ['sberbank'], paymentMethod: 'SBP' });
    ctx.payments.setStatus(first.paymentId as string, 'EXPIRED');

    const second = await ctx.orders.createOrder(BUYER, { appIds: ['sberbank'], paymentMethod: 'SBP' });

    expect(second.id).not.toBe(first.id);
    expect((await ctx.repos.orders.findById(first.id))?.status).toBe('expired');
  });

  it('maps catalog failures to CATALOG_PROVIDER_ERROR', async () => {
    vi.spyOn(ctx.catalog, 'getApp').mockRejectedValue(new Error('timeout'));
    await expect(ctx.orders.createOrder(BUYER, { appIds: ['sberbank'], paymentMethod: 'SBP' })).rejects.toMatchObject({
      code: 'CATALOG_PROVIDER_ERROR',
    });
  });

  it('marks the order failed when the payment provider is down', async () => {
    vi.spyOn(ctx.payments, 'createPayment').mockRejectedValue(new Error('down'));

    await expect(ctx.orders.createOrder(BUYER, { appIds: ['sberbank'], paymentMethod: 'SBP' })).rejects.toMatchObject({
      code: 'PAYMENT_PROVIDER_ERROR',
    });
    const [order] = await ctx.repos.orders.listByUser(BUYER.id, 10);
    expect(order?.status).toBe('failed');
  });

  it('maps payment method listing failures to PAYMENT_PROVIDER_ERROR', async () => {
    vi.spyOn(ctx.payments, 'listMethods').mockRejectedValue(new Error('down'));
    await expect(ctx.orders.listPaymentMethods()).rejects.toBeInstanceOf(AppError);
  });
});

describe('OrderService payment webhooks', () => {
  it('marks the order paid and notifies every admin and the buyer', async () => {
    const paid = await createPaidOrder(ctx);

    expect(paid.status).toBe('paid');
    expect(paid.paidAt).not.toBeNull();
    const recipients = ctx.sender.sent.map((message) => message.chatId);
    expect(recipients).toEqual([...ADMIN_IDS, BUYER.id]);
    expect(ctx.sender.sent[0]?.html).toContain('Новая покупка');
    expect(ctx.sender.sent[2]?.button?.webAppUrl).toBe(`https://shop.example.com#/orders/${paid.id}`);
  });

  it('is idempotent for repeated PAID webhooks', async () => {
    const paid = await createPaidOrder(ctx);
    const payment = await ctx.payments.getPayment(paid.paymentId as string);

    await ctx.orders.handlePaymentWebhook(paid.paymentOrderId, { ...payment, isSandbox: false });

    expect(ctx.sender.sent).toHaveLength(ADMIN_IDS.length + 1);
  });

  it('ignores sandbox payments when they are not accepted', async () => {
    const strict = new OrderService({
      repos: ctx.repos,
      catalog: ctx.catalog,
      payments: ctx.payments,
      notifications: ctx.notifications,
      logger: silentLogger,
      returnUrl: () => null,
      acceptSandboxPayments: false,
      now: ctx.clock.now,
    });
    const order = await strict.createOrder(BUYER, { appIds: ['sberbank'], paymentMethod: 'SBP' });

    await strict.handlePaymentWebhook(order.paymentOrderId, {
      paymentId: order.paymentId as string,
      status: 'PAID',
      amountKopecks: order.amountKopecks,
      isSandbox: true,
    });

    expect((await ctx.repos.orders.findById(order.id))?.status).toBe('awaiting_payment');
  });

  it('confirms through the payment API when the webhook amount is not in rubles', async () => {
    const order = await ctx.orders.createOrder(BUYER, { appIds: ['sberbank'], paymentMethod: 'SBP' });
    ctx.payments.setStatus(order.paymentId as string, 'PAID');
    const getPayment = vi.spyOn(ctx.payments, 'getPayment');

    await ctx.orders.handlePaymentWebhook(order.paymentOrderId, {
      paymentId: order.paymentId as string,
      status: 'PAID',
      amountKopecks: null,
      isSandbox: false,
    });

    expect(getPayment).toHaveBeenCalledWith(order.paymentId);
    expect((await ctx.repos.orders.findById(order.id))?.status).toBe('paid');
  });

  it('does not deliver a payment when the confirmed amount differs', async () => {
    const order = await ctx.orders.createOrder(BUYER, { appIds: ['sberbank'], paymentMethod: 'SBP' });
    vi.spyOn(ctx.payments, 'getPayment').mockResolvedValue({
      paymentId: order.paymentId as string,
      orderId: order.paymentOrderId,
      status: 'PAID',
      amountKopecks: 431,
      isSandbox: false,
    });

    await ctx.orders.handlePaymentWebhook(order.paymentOrderId, {
      paymentId: order.paymentId as string,
      status: 'PAID',
      amountKopecks: null,
      isSandbox: false,
    });

    expect((await ctx.repos.orders.findById(order.id))?.status).toBe('awaiting_payment');
    expect(ctx.sender.sent[0]?.html).toContain('Сумма оплаты не совпала');
  });

  it('still notifies when the paid event cannot be recorded', async () => {
    const order = await ctx.orders.createOrder(BUYER, { appIds: ['sberbank'], paymentMethod: 'SBP' });
    const payment = ctx.payments.setStatus(order.paymentId as string, 'PAID');
    vi.spyOn(ctx.repos.orderEvents, 'add').mockRejectedValue(new Error('db down'));

    await expect(
      ctx.orders.handlePaymentWebhook(order.paymentOrderId, { ...(payment as NonNullable<typeof payment>), isSandbox: false }),
    ).resolves.toBeUndefined();

    expect((await ctx.repos.orders.findById(order.id))?.status).toBe('paid');
    expect(ctx.sender.sent.map((message) => message.chatId)).toEqual([...ADMIN_IDS, BUYER.id]);
  });

  it('binds the payment id when payment creation timed out on our side', async () => {
    const order = await ctx.orders.createOrder(BUYER, { appIds: ['sberbank'], paymentMethod: 'SBP' });
    const realPaymentId = order.paymentId as string;
    await ctx.repos.orders.update(order.id, { paymentId: null });

    await ctx.orders.handlePaymentWebhook(order.paymentOrderId, {
      paymentId: realPaymentId,
      status: 'PAID',
      amountKopecks: order.amountKopecks,
      isSandbox: false,
    });

    expect(await ctx.repos.orders.findById(order.id)).toMatchObject({ status: 'paid', paymentId: realPaymentId });
  });

  it('alerts admins about an amount mismatch only once', async () => {
    const order = await ctx.orders.createOrder(BUYER, { appIds: ['sberbank'], paymentMethod: 'SBP' });
    const update = { paymentId: order.paymentId as string, status: 'PAID' as const, amountKopecks: 100, isSandbox: false };

    await ctx.orders.handlePaymentWebhook(order.paymentOrderId, update);
    await ctx.orders.handlePaymentWebhook(order.paymentOrderId, update);

    expect(ctx.sender.sent).toHaveLength(ADMIN_IDS.length);
  });

  it('does not deliver when the paid amount differs', async () => {
    const order = await ctx.orders.createOrder(BUYER, { appIds: ['sberbank'], paymentMethod: 'SBP' });

    await ctx.orders.handlePaymentWebhook(order.paymentOrderId, {
      paymentId: order.paymentId as string,
      status: 'PAID',
      amountKopecks: 100,
      isSandbox: false,
    });

    expect((await ctx.repos.orders.findById(order.id))?.status).toBe('awaiting_payment');
    expect(ctx.sender.sent[0]?.html).toContain('Сумма оплаты не совпала');
  });

  it.each([
    ['FAILED', 'failed'],
    ['EXPIRED', 'expired'],
  ] as const)('handles %s', async (status, expected) => {
    const order = await ctx.orders.createOrder(BUYER, { appIds: ['sberbank'], paymentMethod: 'SBP' });
    await ctx.orders.handlePaymentWebhook(order.paymentOrderId, {
      paymentId: order.paymentId as string,
      status,
      amountKopecks: order.amountKopecks,
      isSandbox: false,
    });
    expect((await ctx.repos.orders.findById(order.id))?.status).toBe(expected);
  });

  it('handles refunds of paid orders and notifies admins', async () => {
    const paid = await createPaidOrder(ctx);
    await ctx.orders.handlePaymentWebhook(paid.paymentOrderId, {
      paymentId: paid.paymentId as string,
      status: 'REFUNDED',
      amountKopecks: paid.amountKopecks,
      isSandbox: false,
    });
    expect((await ctx.repos.orders.findById(paid.id))?.status).toBe('refunded');
    expect(ctx.sender.sent.at(-1)?.html).toContain('Возврат');
  });

  it('ignores PENDING, unknown orders and mismatched payment ids', async () => {
    const order = await ctx.orders.createOrder(BUYER, { appIds: ['sberbank'], paymentMethod: 'SBP' });
    const base = { status: 'PAID' as const, amountKopecks: order.amountKopecks, isSandbox: false };

    await ctx.orders.handlePaymentWebhook(order.paymentOrderId, { ...base, status: 'PENDING', paymentId: order.paymentId as string });
    await ctx.orders.handlePaymentWebhook('unknown', { ...base, paymentId: 'x' });
    await ctx.orders.handlePaymentWebhook(order.paymentOrderId, { ...base, paymentId: 'someone-else' });

    expect((await ctx.repos.orders.findById(order.id))?.status).toBe('awaiting_payment');
    expect(ctx.sender.sent).toHaveLength(0);
  });
});

describe('OrderService.cancelOrder', () => {
  it('cancels an unpaid order of its owner and records the event', async () => {
    const order = await ctx.orders.createOrder(BUYER, { appIds: ['sberbank'], paymentMethod: 'SBP' });

    const cancelled = await ctx.orders.cancelOrder(BUYER.id, order.id);

    expect(cancelled.status).toBe('cancelled');
    expect(await ctx.repos.orderEvents.has(order.id, 'cancelled')).toBe(true);
  });

  it('is idempotent for an already cancelled order', async () => {
    const order = await ctx.orders.createOrder(BUYER, { appIds: ['sberbank'], paymentMethod: 'SBP' });
    await ctx.orders.cancelOrder(BUYER.id, order.id);

    expect((await ctx.orders.cancelOrder(BUYER.id, order.id)).status).toBe('cancelled');
  });

  it('refuses to cancel paid orders and hides foreign ones', async () => {
    const paid = await createPaidOrder(ctx);
    await expect(ctx.orders.cancelOrder(BUYER.id, paid.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });

    const order = await ctx.orders.createOrder(BUYER, { appIds: ['canva'], paymentMethod: 'SBP' });
    await expect(ctx.orders.cancelOrder(OTHER_USER.id, order.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('still delivers when the buyer pays a cancelled invoice anyway', async () => {
    const order = await ctx.orders.createOrder(BUYER, { appIds: ['sberbank'], paymentMethod: 'SBP' });
    await ctx.orders.cancelOrder(BUYER.id, order.id);
    const payment = ctx.payments.setStatus(order.paymentId as string, 'PAID');

    await ctx.orders.handlePaymentWebhook(order.paymentOrderId, payment as NonNullable<typeof payment>);

    expect((await ctx.repos.orders.findById(order.id))?.status).toBe('paid');
  });

  it('does not reuse a cancelled invoice for a new order', async () => {
    const first = await ctx.orders.createOrder(BUYER, { appIds: ['sberbank'], paymentMethod: 'SBP' });
    await ctx.orders.cancelOrder(BUYER.id, first.id);

    const second = await ctx.orders.createOrder(BUYER, { appIds: ['sberbank'], paymentMethod: 'SBP' });

    expect(second.id).not.toBe(first.id);
  });
});

describe('OrderService.getOrder', () => {
  it('hides orders of other users', async () => {
    const order = await ctx.orders.createOrder(BUYER, { appIds: ['sberbank'], paymentMethod: 'SBP' });
    await expect(ctx.orders.getOrder(OTHER_USER.id, order.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('syncs payment status from the provider when the webhook is late', async () => {
    const order = await ctx.orders.createOrder(BUYER, { appIds: ['sberbank'], paymentMethod: 'SBP' });
    ctx.payments.setStatus(order.paymentId as string, 'PAID');

    const synced = await ctx.orders.getOrder(BUYER.id, order.id);

    expect(synced.status).toBe('paid');
  });

  it('does not accept sandbox payments found by polling when sandbox is not allowed', async () => {
    const strict = new OrderService({
      repos: ctx.repos,
      catalog: ctx.catalog,
      payments: ctx.payments,
      notifications: ctx.notifications,
      logger: silentLogger,
      returnUrl: () => null,
      acceptSandboxPayments: false,
      now: ctx.clock.now,
    });
    const order = await strict.createOrder(BUYER, { appIds: ['sberbank'], paymentMethod: 'SBP' });
    vi.spyOn(ctx.payments, 'getPayment').mockResolvedValue({
      paymentId: order.paymentId as string,
      orderId: order.paymentOrderId,
      status: 'PAID',
      amountKopecks: order.amountKopecks,
      isSandbox: true,
    });

    const polled = await strict.getOrder(BUYER.id, order.id);

    expect(polled.status).toBe('awaiting_payment');
    expect(ctx.sender.sent).toHaveLength(0);
  });

  it('throttles provider polling', async () => {
    const order = await ctx.orders.createOrder(BUYER, { appIds: ['sberbank'], paymentMethod: 'SBP' });
    const spy = vi.spyOn(ctx.payments, 'getPayment');

    await ctx.orders.getOrder(BUYER.id, order.id);
    await ctx.orders.getOrder(BUYER.id, order.id);
    expect(spy).toHaveBeenCalledTimes(1);

    ctx.clock.advance(PAYMENT_SYNC_INTERVAL_MS);
    await ctx.orders.getOrder(BUYER.id, order.id);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('returns the stored order when polling fails', async () => {
    const order = await ctx.orders.createOrder(BUYER, { appIds: ['sberbank'], paymentMethod: 'SBP' });
    vi.spyOn(ctx.payments, 'getPayment').mockRejectedValue(new Error('down'));

    expect((await ctx.orders.getOrder(BUYER.id, order.id)).status).toBe('awaiting_payment');
  });

  it('lists only the user orders, newest first', async () => {
    await ctx.orders.createOrder(BUYER, { appIds: ['sberbank'], paymentMethod: 'SBP' });
    await ctx.orders.createOrder(BUYER, { appIds: ['minecraft'], paymentMethod: 'SBP' });
    await ctx.orders.createOrder(OTHER_USER, { appIds: ['canva'], paymentMethod: 'SBP' });

    const list = await ctx.orders.listOrders(BUYER.id);
    expect(list.map((order) => order.items[0]?.appId)).toEqual(['minecraft', 'sberbank']);
  });
});
