import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signInitData } from '../lib/telegram-init-data.js';
import { CisPayProvider, signCisPayBody } from '../providers/payment/cispay-provider.js';
import { BOT_TOKEN, BUYER, OTHER_USER, createTestContext, type TestContext } from '../test/fixtures.js';
import { buildApp, type AppDeps } from './app.js';

const CISPAY_KEY = 'cis_sec_test';

let ctx: TestContext;
let app: FastifyInstance;

function authHeader(user = BUYER): Record<string, string> {
  const initData = signInitData(
    {
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: user.id, first_name: user.firstName, username: user.username ?? undefined }),
    },
    BOT_TOKEN,
  );
  return { authorization: `tma ${initData}` };
}

function baseDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  return {
    botToken: BOT_TOKEN,
    allowedOrigin: 'https://shop.example.com',
    links: { channelUrl: 'https://t.me/test_channel', supportUrl: 'https://t.me/support', termsUrl: null },
    channel: ctx.channel,
    repos: ctx.repos,
    catalog: ctx.catalog,
    payments: ctx.payments,
    mockPayments: ctx.payments,
    orders: ctx.orders,
    delivery: ctx.deliveryService,
    tickets: ctx.tickets,
    subscription: ctx.subscription,
    ...overrides,
  };
}

beforeEach(async () => {
  ctx = createTestContext();
  ctx.members.set(BUYER.id, { status: 'member' });
  ctx.members.set(OTHER_USER.id, { status: 'member' });
  app = await buildApp(baseDeps());
});

afterEach(async () => {
  await app.close();
});

describe('auth and subscription gate', () => {
  it('rejects requests without initData', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/catalog/apps' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED' } });
  });

  it('rejects forged initData', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/catalog/apps',
      headers: { authorization: 'tma user=%7B%7D&auth_date=1&hash=' + 'a'.repeat(64) },
    });
    expect(response.statusCode).toBe(401);
  });

  it('blocks unsubscribed users but still answers /me', async () => {
    ctx.members.set(BUYER.id, { status: 'left' });

    const blocked = await app.inject({ method: 'GET', url: '/api/catalog/apps', headers: authHeader() });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('NOT_SUBSCRIBED');

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: authHeader() });
    expect(me.json()).toMatchObject({
      success: true,
      data: { isSubscribed: false, channelUrl: 'https://t.me/test_channel', user: { id: BUYER.id } },
    });
  });

  it('re-checks subscription on demand', async () => {
    ctx.members.set(BUYER.id, { status: 'left' });
    await app.inject({ method: 'GET', url: '/api/me', headers: authHeader() });
    ctx.members.set(BUYER.id, { status: 'member' });

    const check = await app.inject({ method: 'POST', url: '/api/me/subscription/check', headers: authHeader() });
    expect(check.json().data).toEqual({ isSubscribed: true });
  });

  it('supports the development user without initData', async () => {
    await app.close();
    app = await buildApp(baseDeps({ devUserId: BUYER.id }));
    const response = await app.inject({ method: 'GET', url: '/api/catalog/categories' });
    expect(response.statusCode).toBe(200);
  });
});

describe('catalog', () => {
  it('filters apps by category and query', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/catalog/apps?category=games&q=mine',
      headers: authHeader(),
    });
    expect(response.json().data.map((item: { id: string }) => item.id)).toEqual(['minecraft']);
  });

  it('returns 404 envelope for unknown apps and maps provider failures', async () => {
    const missing = await app.inject({ method: 'GET', url: '/api/catalog/apps/none', headers: authHeader() });
    expect(missing.statusCode).toBe(404);

    const getApp = vi.spyOn(ctx.catalog, 'getApp');
    const malformed = await app.inject({ method: 'GET', url: '/api/catalog/apps/..%2Fadmin', headers: authHeader() });
    expect(malformed.statusCode).toBe(400);
    expect(getApp).not.toHaveBeenCalled();

    vi.spyOn(ctx.catalog, 'listCategories').mockRejectedValue(new Error('down'));
    const failed = await app.inject({ method: 'GET', url: '/api/catalog/categories', headers: authHeader() });
    expect(failed.statusCode).toBe(502);
    expect(failed.json().error.code).toBe('CATALOG_PROVIDER_ERROR');
  });

  it('lists payment methods with the card minimum', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/payment-methods', headers: authHeader() });
    expect(response.json().data).toContainEqual({ method: 'CARD', minAmountKopecks: 5000 });
  });
});

describe('profile and gate data', () => {
  it('returns channel info and the terms link with /me', async () => {
    await app.close();
    app = await buildApp(
      baseDeps({ links: { channelUrl: 'https://t.me/test_channel', supportUrl: 'https://t.me/support', termsUrl: 'https://telegra.ph/terms' } }),
    );

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: authHeader() });

    expect(me.json().data).toMatchObject({
      termsUrl: 'https://telegra.ph/terms',
      channel: { title: 'AppDrop', subscriberCount: 42_800 },
    });
  });
});

describe('order lifecycle through HTTP', () => {
  it('reports when an unpaid invoice expires and lets the buyer cancel it', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: authHeader(),
      payload: { appId: 'sberbank', paymentMethod: 'SBP' },
    });
    const order = created.json().data;
    const lifetimeMs = Date.parse(order.expiresAt) - Date.parse(order.createdAt);
    expect(lifetimeMs).toBe(30 * 60 * 1000);

    const cancelled = await app.inject({ method: 'POST', url: `/api/orders/${order.id}/cancel`, headers: authHeader() });

    expect(cancelled.json().data).toMatchObject({ status: 'cancelled', expiresAt: null, paymentUrl: null });
  });

  it('hides other buyers orders from cancellation', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: authHeader(),
      payload: { appId: 'sberbank', paymentMethod: 'SBP' },
    });

    const foreign = await app.inject({
      method: 'POST',
      url: `/api/orders/${created.json().data.id}/cancel`,
      headers: authHeader(OTHER_USER),
    });

    expect(foreign.statusCode).toBe(404);
  });
});

describe('purchase flow through HTTP', () => {
  it('buys, pays on the mock page and receives credentials', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: authHeader(),
      payload: { appId: 'sberbank', paymentMethod: 'SBP' },
    });
    expect(created.statusCode).toBe(200);
    const order = created.json().data;
    expect(order).toMatchObject({ status: 'awaiting_payment', amountKopecks: 34900 });

    const paymentPath = new URL(order.paymentUrl).pathname;
    const pageResponse = await app.inject({ method: 'GET', url: paymentPath });
    expect(pageResponse.body).toContain('Тестовая оплата');
    const payResponse = await app.inject({
      method: 'POST',
      url: `${paymentPath}/paid`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: '',
    });
    expect(payResponse.body).toContain('Оплачено');

    const paid = await app.inject({ method: 'GET', url: `/api/orders/${order.id}`, headers: authHeader() });
    expect(paid.json().data).toMatchObject({ status: 'paid', paymentUrl: null });

    const download = await app.inject({ method: 'GET', url: `/api/orders/${order.id}/download`, headers: authHeader() });
    expect(download.headers['cache-control']).toBe('no-store');

    await app.inject({ method: 'POST', url: `/api/orders/${order.id}/confirm-download`, headers: authHeader() });
    const credentials = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/credentials`,
      headers: authHeader(),
    });
    expect(credentials.json().data).toHaveProperty('password');

    const code = await app.inject({ method: 'POST', url: `/api/orders/${order.id}/code`, headers: authHeader() });
    expect(code.json().data.code).toMatch(/^\d{6}$/);

    const done = await app.inject({ method: 'POST', url: `/api/orders/${order.id}/complete`, headers: authHeader() });
    expect(done.json().data.status).toBe('completed');

    const list = await app.inject({ method: 'GET', url: '/api/orders', headers: authHeader() });
    expect(list.json().data).toHaveLength(1);
  });

  it('validates input and hides other users orders', async () => {
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: authHeader(),
      payload: { appId: 'sberbank', paymentMethod: 'TPAY' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('VALIDATION_ERROR');

    const order = await ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'SBP' });
    const foreign = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/credentials`,
      headers: authHeader(OTHER_USER),
    });
    expect(foreign.statusCode).toBe(404);

    const badId = await app.inject({ method: 'GET', url: '/api/orders/abc', headers: authHeader() });
    expect(badId.statusCode).toBe(400);
  });

  it('creates support tickets', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/tickets',
      headers: authHeader(),
      payload: { message: 'Код не приходит уже 10 минут' },
    });
    expect(response.json()).toMatchObject({ success: true, data: { id: 1 } });
    expect(ctx.sender.sent).toHaveLength(2);
  });

  it('answers the mock pay page for unknown payments', async () => {
    const response = await app.inject({ method: 'GET', url: '/dev/mock-pay/unknown' });
    expect(response.body).toContain('Платёж не найден');
  });
});

describe('CISPAY webhook', () => {
  async function appWithCisPay(): Promise<{ order: Awaited<ReturnType<typeof ctx.orders.createOrder>> }> {
    const order = await ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'SBP' });
    const cispay = new CisPayProvider({
      apiUrl: 'https://api.cispay.app',
      shopId: '0192a4b8-0000-7000-8000-000000000001',
      apiKey: CISPAY_KEY,
      fetchFn: vi.fn<typeof fetch>(),
    });
    await app.close();
    app = await buildApp(baseDeps({ payments: cispay, mockPayments: undefined }));
    return { order };
  }

  function webhookBody(paymentOrderId: string, paymentId: string): string {
    return JSON.stringify({
      id: paymentId,
      order_id: paymentOrderId,
      payment_method: 'SBP',
      status: 'PAID',
      amount: 34900,
      currency: 'RUB',
      is_sandbox: false,
    });
  }

  it('accepts a correctly signed webhook and marks the order paid', async () => {
    const { order } = await appWithCisPay();
    const body = webhookBody(order.paymentOrderId, order.paymentId as string);

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/cispay',
      headers: { 'content-type': 'application/json', 'x-signature': signCisPayBody(CISPAY_KEY, body) },
      payload: body,
    });

    expect(response.statusCode).toBe(200);
    expect((await ctx.repos.orders.findById(order.id))?.status).toBe('paid');
  });

  it('rejects webhooks with a bad signature', async () => {
    const { order } = await appWithCisPay();
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/cispay',
      headers: { 'content-type': 'application/json', 'x-signature': 'f'.repeat(64) },
      payload: webhookBody(order.paymentOrderId, order.paymentId as string),
    });

    expect(response.statusCode).toBe(401);
    expect((await ctx.repos.orders.findById(order.id))?.status).toBe('awaiting_payment');
  });

  it('does not expose the mock payment page with a real provider', async () => {
    await appWithCisPay();
    const response = await app.inject({ method: 'GET', url: '/dev/mock-pay/x' });
    expect(response.statusCode).toBe(404);
  });
});

describe('misc', () => {
  it('serves health and security headers', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.json().data).toEqual({ status: 'ok' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('turns unexpected errors into INTERNAL_ERROR without leaking details', async () => {
    vi.spyOn(ctx.repos.users, 'upsert').mockRejectedValue(new Error('db password=secret'));
    const response = await app.inject({ method: 'GET', url: '/api/me', headers: authHeader() });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('secret');
  });

  it('rate limits code requests', async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await app.inject({ method: 'POST', url: '/api/orders/999/code', headers: authHeader() });
      statuses.push(response.statusCode);
    }
    expect(statuses.at(-1)).toBe(429);
  });
});
