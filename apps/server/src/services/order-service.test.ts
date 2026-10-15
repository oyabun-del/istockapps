import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../lib/app-error.js';
import { ADMIN_IDS, BUYER, OTHER_USER, createPaidOrder, createTestContext, type TestContext } from '../test/fixtures.js';
import { silentLogger } from '../lib/logger.js';
import { OrderService, PAYMENT_SYNC_INTERVAL_MS } from './order-service.js';

let ctx: TestContext;

beforeEach(() => {
  ctx = createTestContext();
});

describe('OrderService.createOrder', () => {
  it('creates an order priced from the catalog and opens a payment', async () => {
    const order = await ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'SBP' });

    expect(order).toMatchObject({
      userId: BUYER.id,
      appId: 'sberbank',
      appName: 'СберБанк Онлайн',
      amountKopecks: 34900,
      status: 'awaiting_payment',
      paymentMethod: 'SBP',
    });
    expect(order.paymentUrl).toMatch(/\/dev\/mock-pay\//);
    expect(await ctx.repos.users.findById(BUYER.id)).not.toBeNull();
  });

  it('rejects unknown apps', async () => {
    await expect(ctx.orders.createOrder(BUYER, { appId: 'nope', paymentMethod: 'SBP' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('rejects disabled payment methods', async () => {
    vi.spyOn(ctx.payments, 'listMethods').mockResolvedValue(['SBP']);
    await expect(ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'CARD' })).rejects.toMatchObject({
      code: 'PAYMENT_METHOD_UNAVAILABLE',
    });
  });

  it('reuses a fresh unpaid order for the same app and method', async () => {
    const first = await ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'SBP' });
    const second = await ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'SBP' });
    const otherMethod = await ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'CARD' });

    expect(second.id).toBe(first.id);
    expect(otherMethod.id).not.toBe(first.id);
  });

  it('does not reuse an invoice that CISPAY already expired', async () => {
    const first = await ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'SBP' });
    ctx.payments.setStatus(first.paymentId as string, 'EXPIRED');

    const second = await ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'SBP' });

    expect(second.id).not.toBe(first.id);
    expect((await ctx.repos.orders.findById(first.id))?.status).toBe('expired');
  });

  it('maps catalog failures to CATALOG_PROVIDER_ERROR', async () => {
    vi.spyOn(ctx.catalog, 'getApp').mockRejectedValue(new Error('timeout'));
    await expect(ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'SBP' })).rejects.toMatchObject({
      code: 'CATALOG_PROVIDER_ERROR',
    });
  });

  it('marks the order failed when the payment provider is down', async () => {
    vi.spyOn(ctx.payments, 'createPayment').mockRejectedValue(new Error('down'));

    await expect(ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'SBP' })).rejects.toMatchObject({
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
    const order = await strict.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'SBP' });

    await strict.handlePaymentWebhook(order.paymentOrderId, {
      paymentId: order.paymentId as string,
      status: 'PAID',
      amountKopecks: order.amountKopecks,
      isSandbox: true,
    });

    expect((await ctx.repos.orders.findById(order.id))?.status).toBe('awaiting_payment');
  });

  it('confirms through the payment API when the webhook amount is not in rubles (CRYPTO)', async () => {
    const order = await ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'CRYPTO' });
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

  it('does not deliver a CRYPTO payment when the confirmed amount differs', async () => {
    const order = await ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'CRYPTO' });
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
    const order = await ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'SBP' });
    const payment = ctx.payments.setStatus(order.paymentId as string, 'PAID');
    vi.spyOn(ctx.repos.orderEvents, 'add').mockRejectedValue(new Error('db down'));

    await expect(
      ctx.orders.handlePaymentWebhook(order.paymentOrderId, { ...(payment as NonNullable<typeof payment>), isSandbox: false }),
    ).resolves.toBeUndefined();

    expect((await ctx.repos.orders.findById(order.id))?.status).toBe('paid');
    expect(ctx.sender.sent.map((message) => message.chatId)).toEqual([...ADMIN_IDS, BUYER.id]);
  });

  it('binds the payment id when payment creation timed out on our side', async () => {
    const order = await ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'SBP' });
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
    const order = await ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'SBP' });
    const update = { paymentId: order.paymentId as string, status: 'PAID' as const, amountKopecks: 100, isSandbox: false };

    await ctx.orders.handlePaymentWebhook(order.paymentOrderId, update);
    await ctx.orders.handlePaymentWebhook(order.paymentOrderId, update);

    expect(ctx.sender.sent).toHaveLength(ADMIN_IDS.length);
  });

  it('does not deliver when the paid amount differs', async () => {
    const order = await ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'SBP' });

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
    const order = await ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'SBP' });
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
    const order = await ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'SBP' });
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
    const order = await ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'SBP' });

    const cancelled = await ctx.orders.cancelOrder(BUYER.id, order.id);

    expect(cancelled.status).toBe('cancelled');
    expect(await ctx.repos.orderEvents.has(order.id, 'cancelled')).toBe(true);
  });

  it('is idempotent for an already cancelled order', async () => {
    const order = await ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'SBP' });
    await ctx.orders.cancelOrder(BUYER.id, order.id);

    expect((await ctx.orders.cancelOrder(BUYER.id, order.id)).status).toBe('cancelled');
  });

  it('refuses to cancel paid orders and hides foreign ones', async () => {
    const paid = await createPaidOrder(ctx);
    await expect(ctx.orders.cancelOrder(BUYER.id, paid.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });

    const order = await ctx.orders.createOrder(BUYER, { appId: 'canva', paymentMethod: 'SBP' });
    await expect(ctx.orders.cancelOrder(OTHER_USER.id, order.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('still delivers when the buyer pays a cancelled invoice anyway', async () => {
    const order = await ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'SBP' });
    await ctx.orders.cancelOrder(BUYER.id, order.id);
    const payment = ctx.payments.setStatus(order.paymentId as string, 'PAID');

    await ctx.orders.handlePaymentWebhook(order.paymentOrderId, payment as NonNullable<typeof payment>);

    expect((await ctx.repos.orders.findById(order.id))?.status).toBe('paid');
  });

  it('does not reuse a cancelled invoice for a new order', async () => {
    const first = await ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'SBP' });
    await ctx.orders.cancelOrder(BUYER.id, first.id);

    const second = await ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'SBP' });

    expect(second.id).not.toBe(first.id);
  });
});

describe('OrderService.getOrder', () => {
  it('hides orders of other users', async () => {
    const order = await ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'SBP' });
    await expect(ctx.orders.getOrder(OTHER_USER.id, order.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('syncs payment status from the provider when the webhook is late', async () => {
    const order = await ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'SBP' });
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
    const order = await strict.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'SBP' });
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
    const order = await ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'SBP' });
    const spy = vi.spyOn(ctx.payments, 'getPayment');

    await ctx.orders.getOrder(BUYER.id, order.id);
    await ctx.orders.getOrder(BUYER.id, order.id);
    expect(spy).toHaveBeenCalledTimes(1);

    ctx.clock.advance(PAYMENT_SYNC_INTERVAL_MS);
    await ctx.orders.getOrder(BUYER.id, order.id);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('returns the stored order when polling fails', async () => {
    const order = await ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'SBP' });
    vi.spyOn(ctx.payments, 'getPayment').mockRejectedValue(new Error('down'));

    expect((await ctx.orders.getOrder(BUYER.id, order.id)).status).toBe('awaiting_payment');
  });

  it('lists only the user orders, newest first', async () => {
    await ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'SBP' });
    await ctx.orders.createOrder(BUYER, { appId: 'minecraft', paymentMethod: 'SBP' });
    await ctx.orders.createOrder(OTHER_USER, { appId: 'canva', paymentMethod: 'SBP' });

    const list = await ctx.orders.listOrders(BUYER.id);
    expect(list.map((order) => order.appId)).toEqual(['minecraft', 'sberbank']);
  });
});
