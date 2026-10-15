import { describe, expect, it, vi } from 'vitest';
import { CisPayProvider, signCisPayBody, verifyCisPaySignature } from './cispay-provider.js';
import { PaymentProviderError } from './payment-provider.js';

const API_KEY = 'cis_sec_test_key';
const SHOP_ID = '0192a4b8-0000-7000-8000-000000000001';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function createProvider(fetchFn: typeof fetch, now = () => 0) {
  return new CisPayProvider({ apiUrl: 'https://api.cispay.app', shopId: SHOP_ID, apiKey: API_KEY, fetchFn, now });
}

describe('CisPayProvider.createPayment', () => {
  it('sends amount in kopecks with auth headers and returns the payment url', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: 'pay-1',
        order_id: 'ord-1',
        status: 'PENDING',
        amount: 34900,
        charged_amount: 34900,
        payment_url: 'https://pay.cispay.app/p/pay-1',
        created_at: '2026-10-14T12:00:00Z',
      }, 201),
    );

    const result = await createProvider(fetchFn).createPayment({
      orderId: 'ord-1',
      amountKopecks: 34900,
      method: 'SBP',
      customerId: '42',
      description: 'СберБанк, заказ #1',
      successUrl: 'https://t.me/bot?start=1',
      failUrl: null,
    });

    expect(result).toEqual({ paymentId: 'pay-1', paymentUrl: 'https://pay.cispay.app/p/pay-1' });
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('https://api.cispay.app/payments');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ 'X-Shop-ID': SHOP_ID, 'X-Api-Key': API_KEY });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      amount: 34900,
      currency: 'RUB',
      order_id: 'ord-1',
      payment_method: 'SBP',
      customer_id: '42',
      redirect_success_url: 'https://t.me/bot?start=1',
    });
  });

  it('wraps HTTP errors', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"detail":"bad"}', { status: 400 }));
    await expect(
      createProvider(fetchFn).createPayment({
        orderId: 'o',
        amountKopecks: 100,
        method: 'CARD',
        customerId: '1',
        description: 'x',
        successUrl: null,
        failUrl: null,
      }),
    ).rejects.toThrow(/failed: 400/);
  });

  it('wraps network errors and invalid JSON', async () => {
    const network = vi.fn<typeof fetch>().mockRejectedValue(new Error('ECONNRESET'));
    await expect(createProvider(network).getPayment('p')).rejects.toBeInstanceOf(PaymentProviderError);

    const garbage = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>', { status: 200 }));
    await expect(createProvider(garbage).getPayment('p')).rejects.toThrow(/invalid JSON/);
  });

  it('fails when CISPAY returns no payment url', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ id: 'p', order_id: 'o', status: 'PENDING', amount: 1, payment_url: null }));
    await expect(
      createProvider(fetchFn).createPayment({
        orderId: 'o',
        amountKopecks: 1,
        method: 'SBP',
        customerId: '1',
        description: 'x',
        successUrl: null,
        failUrl: null,
      }),
    ).rejects.toThrow(/no https payment_url/);
  });
});

describe('CisPayProvider.getPayment', () => {
  it('queries status by transaction id', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ id: 'pay-1', order_id: 'ord-1', status: 'PAID', amount: 500 }));

    const state = await createProvider(fetchFn).getPayment('pay-1');

    expect(state).toEqual({ paymentId: 'pay-1', orderId: 'ord-1', status: 'PAID', amountKopecks: 500 });
    expect(fetchFn.mock.calls[0]?.[0]).toBe('https://api.cispay.app/payments/status?id=pay-1');
  });
});

describe('CisPayProvider.listMethods', () => {
  const capabilities = {
    store_id: SHOP_ID,
    store_name: 'Shop',
    is_active: true,
    payment_methods: [
      { payment_method: 'SBP', is_active: true, system_fee_percent: 350, customer_fee_share_percent: 0 },
      { payment_method: 'CARD', is_active: false, system_fee_percent: 350, customer_fee_share_percent: 0 },
      { payment_method: 'CRYPTO', is_active: true, system_fee_percent: 100, customer_fee_share_percent: 0 },
      { payment_method: 'NEW_THING', is_active: true, system_fee_percent: 0, customer_fee_share_percent: 0 },
    ],
  };

  it('returns active known methods and caches them', async () => {
    let now = 0;
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse(capabilities));
    const provider = createProvider(fetchFn, () => now);

    expect(await provider.listMethods()).toEqual(['SBP', 'CRYPTO']);
    await provider.listMethods();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    now += 5 * 60 * 1000 + 1;
    await provider.listMethods();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('returns nothing when the shop is inactive', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ...capabilities, is_active: false }));
    expect(await createProvider(fetchFn).listMethods()).toEqual([]);
  });
});

describe('CISPAY webhooks', () => {
  const body = Buffer.from(
    JSON.stringify({
      id: 'pay-1',
      store_id: SHOP_ID,
      order_id: 'ord-1',
      payment_method: 'SBP',
      status: 'PAID',
      amount: 34900,
      currency: 'RUB',
      charged_amount: 34900,
      merchant_revenue: 33678,
      is_sandbox: true,
      description: null,
      subscription_id: null,
      paid_at: '2026-10-14T12:00:00+00:00',
      timestamp: '2026-10-14T12:00:01+00:00',
    }),
  );

  it('verifies HMAC-SHA256 signatures', () => {
    const signature = signCisPayBody(API_KEY, body);
    expect(verifyCisPaySignature(API_KEY, body, signature)).toBe(true);
    expect(verifyCisPaySignature('cis_sec_other', body, signature)).toBe(false);
    expect(verifyCisPaySignature(API_KEY, body, 'not-hex')).toBe(false);
  });

  it('parses a signed webhook', () => {
    const provider = createProvider(vi.fn<typeof fetch>());
    const parsed = provider.parseWebhook(body, { 'x-signature': signCisPayBody(API_KEY, body) });
    expect(parsed).toEqual({ paymentId: 'pay-1', orderId: 'ord-1', status: 'PAID', amountKopecks: 34900, isSandbox: true });
  });

  it('rejects unsigned, tampered or malformed webhooks', () => {
    const provider = createProvider(vi.fn<typeof fetch>());
    expect(provider.parseWebhook(body, {})).toBeNull();

    const tampered = Buffer.from(body.toString().replace('34900', '100'));
    expect(provider.parseWebhook(tampered, { 'x-signature': signCisPayBody(API_KEY, body) })).toBeNull();

    const notJson = Buffer.from('nope');
    expect(provider.parseWebhook(notJson, { 'x-signature': [signCisPayBody(API_KEY, notJson)] })).toBeNull();

    const wrongShape = Buffer.from('{"id":1}');
    expect(provider.parseWebhook(wrongShape, { 'x-signature': signCisPayBody(API_KEY, wrongShape) })).toBeNull();
  });
});
