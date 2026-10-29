import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initDataSecret, signInitData } from '../lib/telegram-init-data.js';
import { MOCK_CODE_AFTER_POLLS } from '../providers/delivery/mock-delivery-provider.js';
import { CisPayProvider, signCisPayBody } from '../providers/payment/cispay-provider.js';
import { CODE_POLL_MIN_INTERVAL_MS } from '../services/delivery-service.js';
import { BOT_TOKEN, BUYER, OTHER_USER, createPaidOrder, createTestContext, type TestContext } from '../test/fixtures.js';
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
    links: { channelUrl: 'https://t.me/test_channel', supportUrl: 'https://t.me/support' },
    seller: null,
    channel: ctx.channel,
    repos: ctx.repos,
    catalog: ctx.catalog,
    payments: ctx.payments,
    mockPayments: ctx.payments,
    orders: ctx.orders,
    checkout: ctx.checkout,
    delivery: ctx.deliveryService,
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

  it('rejects any initData when there is no bot token (TELEGRAM_OFFLINE)', async () => {
    await app.close();
    app = await buildApp(baseDeps({ botToken: initDataSecret(undefined), devUserId: BUYER.id }));

    const signed = await app.inject({ method: 'GET', url: '/api/catalog/categories', headers: authHeader() });
    expect(signed.statusCode).toBe(401);

    const devUser = await app.inject({ method: 'GET', url: '/api/catalog/categories' });
    expect(devUser.statusCode).toBe(200);
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

  it('lists SBP as the only payment method', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/payment-methods', headers: authHeader() });
    expect(response.json().data).toEqual([{ method: 'SBP' }]);
  });
});

describe('profile and gate data', () => {
  it('returns channel info and the seller details with /me', async () => {
    const seller = { name: 'ИП Иванов Иван Иванович', inn: '500100732259', ogrnip: '304500116000157', email: 'shop@example.com' };
    await app.close();
    app = await buildApp(baseDeps({ seller }));

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: authHeader() });

    expect(me.json().data).toMatchObject({ seller, channel: { title: 'iStockApps', subscriberCount: 42_800 } });
    expect(me.json().data).not.toHaveProperty('termsUrl');
  });
});

describe('order lifecycle through HTTP', () => {
  it('reports when an unpaid invoice expires and lets the buyer cancel it', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: authHeader(),
      payload: { appIds: ['sberbank'], paymentMethod: 'SBP' },
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
      payload: { appIds: ['sberbank'], paymentMethod: 'SBP' },
    });

    const foreign = await app.inject({
      method: 'POST',
      url: `/api/orders/${created.json().data.id}/cancel`,
      headers: authHeader(OTHER_USER),
    });

    expect(foreign.statusCode).toBe(404);
  });

  it('buys a cart of apps with the bulk discount in one order', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: authHeader(),
      payload: { appIds: ['sberbank', 'tbank', 'canva'], paymentMethod: 'SBP', expectedTotalKopecks: 44700 },
    });

    expect(created.statusCode).toBe(200);
    expect(created.json().data).toMatchObject({
      items: [
        { id: 'sberbank', priceKopecks: 34900, discountKopecks: 10000 },
        { id: 'tbank', priceKopecks: 19900, discountKopecks: 10000 },
        { id: 'canva', priceKopecks: 19900, discountKopecks: 10000 },
      ],
      subtotalKopecks: 74700,
      discountKopecks: 30000,
      amountKopecks: 44700,
    });
  });

  it('answers 409 PRICE_CHANGED when the cart total is outdated', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: authHeader(),
      payload: { appIds: ['sberbank', 'tbank', 'canva'], paymentMethod: 'SBP', expectedTotalKopecks: 74700 },
    });

    expect(created.statusCode).toBe(409);
    expect(created.json().error.code).toBe('PRICE_CHANGED');
  });

  it('rejects duplicate apps in one order', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: authHeader(),
      payload: { appIds: ['sberbank', 'sberbank'], paymentMethod: 'SBP' },
    });

    expect(created.statusCode).toBe(400);
  });
});

describe('purchase flow through HTTP', () => {
  it('buys, pays on the mock page and receives credentials', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: authHeader(),
      payload: { appIds: ['sberbank'], paymentMethod: 'SBP' },
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

    const delivery = await app.inject({ method: 'GET', url: `/api/orders/${order.id}/delivery`, headers: authHeader() });
    expect(delivery.headers['cache-control']).toBe('no-store');
    const groupId = delivery.json().data.groups[0].id;
    expect(delivery.json().data.groups[0].apps[0].links.main).toContain('/mock-install/sberbank');

    await app.inject({ method: 'POST', url: `/api/orders/${order.id}/confirm-download`, headers: authHeader() });
    const credentials = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/credentials`,
      headers: authHeader(),
    });
    expect(credentials.headers['cache-control']).toBe('no-store');
    expect(credentials.json().data.groups[0]).toHaveProperty('password');

    const badGroup = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/code`,
      headers: authHeader(),
      payload: { groupId: '../other' },
    });
    expect(badGroup.statusCode).toBe(400);

    const started = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/code`,
      headers: authHeader(),
      payload: { groupId },
    });
    expect(started.json().data).toMatchObject({ status: 'active', code: null });
    const waitId = started.json().data.id;

    let code = started.json().data.code;
    for (let poll = 0; poll < MOCK_CODE_AFTER_POLLS; poll += 1) {
      ctx.clock.advance(CODE_POLL_MIN_INTERVAL_MS);
      const status = await app.inject({ method: 'GET', url: `/api/orders/${order.id}/code/${waitId}`, headers: authHeader() });
      expect(status.headers['cache-control']).toBe('no-store');
      code = status.json().data.code;
    }
    expect(code).toMatch(/^\d{6}$/);
    const afterCode = await app.inject({ method: 'GET', url: `/api/orders/${order.id}`, headers: authHeader() });
    expect(afterCode.json().data.isCodeReceived).toBe(true);

    const done = await app.inject({ method: 'POST', url: `/api/orders/${order.id}/complete`, headers: authHeader() });
    expect(done.json().data.status).toBe('completed');

    const list = await app.inject({ method: 'GET', url: '/api/orders', headers: authHeader() });
    expect(list.json().data).toHaveLength(1);
  });

  it('validates input and hides other users orders', async () => {
    for (const paymentMethod of ['TPAY', 'CARD', 'CRYPTO']) {
      const invalid = await app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: authHeader(),
        payload: { appIds: ['sberbank'], paymentMethod },
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json().error.code).toBe('VALIDATION_ERROR');
    }

    const order = await ctx.orders.createOrder(BUYER, { appIds: ['sberbank'], paymentMethod: 'SBP' });
    const foreign = await app.inject({
      method: 'POST',
      url: `/api/orders/${order.id}/credentials`,
      headers: authHeader(OTHER_USER),
    });
    expect(foreign.statusCode).toBe(404);

    const badId = await app.inject({ method: 'GET', url: '/api/orders/abc', headers: authHeader() });
    expect(badId.statusCode).toBe(400);
  });

  it('lets the buyer skip the code when Apple did not ask for one', async () => {
    const paid = await createPaidOrder(ctx);
    await ctx.deliveryService.confirmDownload(BUYER.id, paid.id);
    await ctx.deliveryService.getCredentials(BUYER.id, paid.id);

    const locked = await app.inject({ method: 'POST', url: `/api/orders/${paid.id}/complete`, headers: authHeader() });
    expect(locked.statusCode).toBe(409);

    const skipped = await app.inject({ method: 'POST', url: `/api/orders/${paid.id}/skip-code`, headers: authHeader() });
    expect(skipped.json().data).toMatchObject({ status: 'credentials_issued', isCodeReceived: true });

    const done = await app.inject({ method: 'POST', url: `/api/orders/${paid.id}/complete`, headers: authHeader() });
    expect(done.json().data.status).toBe('completed');
  });

  it('no longer accepts support tickets', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/tickets',
      headers: authHeader(),
      payload: { message: 'Код не приходит уже 10 минут' },
    });
    expect(response.statusCode).toBe(404);
  });

  it('answers the mock pay page for unknown payments', async () => {
    const response = await app.inject({ method: 'GET', url: '/dev/mock-pay/unknown' });
    expect(response.body).toContain('Платёж не найден');
  });
});

describe('payments mode and promo codes through HTTP', () => {
  it('tells the Mini App who may pay', async () => {
    const open = await app.inject({ method: 'GET', url: '/api/checkout', headers: authHeader() });
    expect(open.json()).toMatchObject({ success: true, data: { paymentsMode: 'open' } });

    await ctx.checkout.setMode('promo');
    const promo = await app.inject({ method: 'GET', url: '/api/checkout', headers: authHeader() });
    expect(promo.json().data).toEqual({ paymentsMode: 'promo' });
  });

  it('checks a promo code and says how many apps it still covers', async () => {
    await ctx.repos.promoCodes.create({ code: 'IOS-REVIEW', maxApps: 5, createdBy: 111 });

    const valid = await app.inject({
      method: 'POST',
      url: '/api/promo/check',
      headers: authHeader(),
      payload: { code: ' ios-review ' },
    });
    expect(valid.json()).toMatchObject({ success: true, data: { code: 'IOS-REVIEW', appsLeft: 5 } });

    const unknown = await app.inject({
      method: 'POST',
      url: '/api/promo/check',
      headers: authHeader(),
      payload: { code: 'nope' },
    });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().error.code).toBe('PROMO_INVALID');
  });

  it('limits promo checks per buyer', async () => {
    const check = () =>
      app.inject({ method: 'POST', url: '/api/promo/check', headers: authHeader(), payload: { code: 'GUESS-1' } });
    for (let attempt = 0; attempt < 10; attempt += 1) await check();

    expect((await check()).statusCode).toBe(429);
  });

  it('opens an invoice by promo code only while payments are open by promo code', async () => {
    await ctx.repos.promoCodes.create({ code: 'IOS-REVIEW', maxApps: 5, createdBy: 111 });
    await ctx.checkout.setMode('promo');
    const create = (promoCode?: string) =>
      app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: authHeader(),
        payload: { appIds: ['sberbank'], paymentMethod: 'SBP', promoCode },
      });

    const refused = await create();
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe('PAYMENTS_CLOSED');

    const created = await create('ios-review');
    expect(created.statusCode).toBe(200);
    expect(created.json().data.status).toBe('awaiting_payment');
  });
});

describe('CISPAY webhook', () => {
  async function appWithCisPay(): Promise<{ order: Awaited<ReturnType<typeof ctx.orders.createOrder>> }> {
    const order = await ctx.orders.createOrder(BUYER, { appIds: ['sberbank'], paymentMethod: 'SBP' });
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

  it('rate limits order creation per buyer, not per IP', async () => {
    const create = (user = BUYER) =>
      app.inject({
        method: 'POST',
        url: '/api/orders',
        headers: authHeader(user),
        payload: { appIds: ['sberbank'], paymentMethod: 'SBP' },
      });
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) statuses.push((await create()).statusCode);

    expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    expect((await create(OTHER_USER)).statusCode).toBe(200);
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

describe('Mini App pages', () => {
  it('serves the Mini App with a content security policy that still lets Telegram frame it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'miniapp-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>iStockApps</title>');
    const withMiniapp = await buildApp(baseDeps({ miniappDir: dir }));
    try {
      const response = await withMiniapp.inject({ method: 'GET', url: '/' });

      expect(response.statusCode).toBe(200);
      const csp = String(response.headers['content-security-policy']);
      expect(csp).toContain("script-src 'self' https://telegram.org");
      expect(csp).toContain("object-src 'none'");
      expect(csp).not.toContain('frame-ancestors');
    } finally {
      await withMiniapp.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not put the page policy on API responses', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.headers['content-security-policy']).toBeUndefined();
  });
});
