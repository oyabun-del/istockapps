import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CispayProvider } from './cispay-provider.js';
import { PaymentProviderError, type CreatePaymentInput } from './payment-provider.js';

const SHOP_ID = '0192a4b8-0000-7000-8000-0000000000c1';
const API_KEY = 'cis_sec_test_key';
const PAYMENT_ID = '0192a4b8-0000-7000-8000-0000000000aa';

const INPUT: CreatePaymentInput = {
  orderId: 'ord-1',
  amountKopecks: 34950,
  method: 'CARD',
  customerId: '42',
  description: 'СберБанк, заказ #1',
  successUrl: 'https://t.me/bot?start=1',
  failUrl: 'https://t.me/bot?start=1',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function createProvider(fetchFn: typeof fetch = vi.fn<typeof fetch>(), now = () => 0) {
  return new CispayProvider({ apiUrl: 'https://api.cispay.app', shopId: SHOP_ID, apiKey: API_KEY, fetchFn, now });
}

function statusBody(fields: Record<string, unknown> = {}) {
  return { id: PAYMENT_ID, order_id: 'ord-1', status: 'PAID', amount: 34950, charged_amount: 36000, currency: 'RUB', is_sandbox: false, ...fields };
}

function sign(body: Buffer, key = API_KEY): string {
  return createHmac('sha256', key).update(body).digest('hex');
}

function callback(fields: Record<string, unknown> = {}): Buffer {
  return Buffer.from(
    JSON.stringify({
      id: PAYMENT_ID,
      store_id: SHOP_ID,
      order_id: 'ord-1',
      payment_method: 'CARD',
      status: 'PAID',
      amount: 34950,
      currency: 'RUB',
      charged_amount: 36000,
      is_sandbox: false,
      ...fields,
    }),
  );
}

describe('CispayProvider.createPayment', () => {
  it('opens a card invoice in kopecks under our order id and returns the payment page', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ id: PAYMENT_ID, order_id: 'ord-1', status: 'PENDING', amount: 34950, charged_amount: 34950, payment_url: 'https://pay.cispay.app/p/1', created_at: '2026-11-18T10:00:00Z' }, 201),
    );

    const result = await createProvider(fetchFn).createPayment(INPUT);

    expect(result).toEqual({ paymentId: PAYMENT_ID, paymentUrl: 'https://pay.cispay.app/p/1' });
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('https://api.cispay.app/payments');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ 'X-Shop-ID': SHOP_ID, 'X-Api-Key': API_KEY });
    expect(JSON.parse(String(init?.body))).toEqual({
      amount: 34950,
      currency: 'RUB',
      order_id: 'ord-1',
      payment_method: 'CARD',
      customer_id: '42',
      redirect_success_url: 'https://t.me/bot?start=1',
      redirect_fail_url: 'https://t.me/bot?start=1',
      description: 'СберБанк, заказ #1',
    });
  });

  it('refuses methods other than card without calling the API', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    await expect(createProvider(fetchFn).createPayment({ ...INPUT, method: 'SBP' })).rejects.toBeInstanceOf(PaymentProviderError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fails without an https payment page', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ id: PAYMENT_ID, payment_url: null }, 201));
    await expect(createProvider(fetchFn).createPayment(INPUT)).rejects.toThrow(/no https payment url/);
  });

  it('reports an API error with its status and the route, not the key', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ detail: 'order_id exists' }, 400));
    const error = await createProvider(fetchFn).createPayment(INPUT).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PaymentProviderError);
    expect(String((error as Error).message)).toMatch(/CisPay POST \/payments failed: 400/);
    expect(String((error as Error).message)).not.toContain(API_KEY);
  });

  it('reports a network failure as a provider error', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    await expect(createProvider(fetchFn).createPayment(INPUT)).rejects.toThrow(/network error/);
  });
});

describe('CispayProvider.getPayment', () => {
  it('reads the status by payment id and takes the net amount', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(statusBody()));

    const state = await createProvider(fetchFn).getPayment(PAYMENT_ID);

    expect(state).toEqual({ paymentId: PAYMENT_ID, orderId: 'ord-1', status: 'PAID', amountKopecks: 34950, isSandbox: false });
    expect(fetchFn.mock.calls[0]?.[0]).toBe(`https://api.cispay.app/payments/status?id=${PAYMENT_ID}`);
    expect(fetchFn.mock.calls[0]?.[1]?.method).toBe('GET');
  });

  it.each([
    ['PENDING', 'PENDING'],
    ['PAID', 'PAID'],
    ['FAILED', 'FAILED'],
    ['EXPIRED', 'EXPIRED'],
    ['REFUNDED', 'REFUNDED'],
    ['SOMETHING_NEW', 'PENDING'],
  ])('maps %s to %s', async (status, expected) => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(statusBody({ status })));
    expect((await createProvider(fetchFn).getPayment(PAYMENT_ID)).status).toBe(expected);
  });

  it('passes the sandbox flag on', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(statusBody({ is_sandbox: true })));
    expect((await createProvider(fetchFn).getPayment(PAYMENT_ID)).isSandbox).toBe(true);
  });

  it('refuses a payment in another currency', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(statusBody({ currency: 'USD' })));
    await expect(createProvider(fetchFn).getPayment(PAYMENT_ID)).rejects.toThrow(/in USD/);
  });

  it('fails on a body that is not JSON', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>', { status: 200 }));
    await expect(createProvider(fetchFn).getPayment(PAYMENT_ID)).rejects.toThrow(/invalid JSON/);
  });
});

describe('CispayProvider.listMethods', () => {
  function capabilities(storeActive: boolean, cardActive: boolean) {
    return jsonResponse({
      store_id: SHOP_ID,
      store_name: 'iStock',
      is_active: storeActive,
      payment_methods: [
        { payment_method: 'SBP', is_active: true, system_fee_percent: 300, customer_fee_share_percent: 0 },
        { payment_method: 'CARD', is_active: cardActive, system_fee_percent: 350, customer_fee_share_percent: 0 },
      ],
    });
  }

  it('offers card only, while both the store and its card method are active', async () => {
    expect(await createProvider(vi.fn<typeof fetch>().mockResolvedValue(capabilities(true, true))).listMethods()).toEqual(['CARD']);
    expect(await createProvider(vi.fn<typeof fetch>().mockResolvedValue(capabilities(true, false))).listMethods()).toEqual([]);
    expect(await createProvider(vi.fn<typeof fetch>().mockResolvedValue(capabilities(false, true))).listMethods()).toEqual([]);
  });

  it('asks again only after a minute', async () => {
    let now = 0;
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async () => capabilities(true, true));
    const provider = createProvider(fetchFn, () => now);

    await provider.listMethods();
    now = 59_999;
    await provider.listMethods();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    now = 60_000;
    await provider.listMethods();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('does not remember a failure', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('down', { status: 503 })).mockResolvedValue(capabilities(true, true));
    const provider = createProvider(fetchFn);

    await expect(provider.listMethods()).rejects.toBeInstanceOf(PaymentProviderError);
    expect(await provider.listMethods()).toEqual(['CARD']);
  });
});

describe('CispayProvider.parseWebhook', () => {
  it('accepts a signed callback and leaves the amount to the status API', () => {
    const body = callback({ is_sandbox: true });
    const result = createProvider().parseWebhook(body, { 'x-signature': sign(body) });

    expect(result).toEqual({
      kind: 'accepted',
      webhook: { paymentId: PAYMENT_ID, orderId: 'ord-1', status: 'PAID', amountKopecks: null, isSandbox: true },
    });
  });

  it('accepts an upper-case hex signature', () => {
    const body = callback();
    expect(createProvider().parseWebhook(body, { 'x-signature': sign(body).toUpperCase() }).kind).toBe('accepted');
  });

  it.each([
    ['no signature', undefined],
    ['a signature made with another key', 'other-key'],
    ['a signature that is not hex', 'not-hex'],
  ])('rejects a callback with %s', (_name, variant) => {
    const body = callback();
    const headers: Record<string, string> = {};
    if (variant === 'other-key') headers['x-signature'] = sign(body, 'other-key');
    if (variant === 'not-hex') headers['x-signature'] = 'z'.repeat(64);
    expect(createProvider().parseWebhook(body, headers)).toEqual({ kind: 'unauthorized' });
  });

  it('rejects a body changed after signing', () => {
    const signature = sign(callback());
    const forged = callback({ status: 'REFUNDED' });
    expect(createProvider().parseWebhook(forged, { 'x-signature': signature })).toEqual({ kind: 'unauthorized' });
  });

  it('ignores subscription events', () => {
    const body = Buffer.from(JSON.stringify({ event: 'subscription.cancelled', object: 'subscription', id: 'sub-1' }));
    expect(createProvider().parseWebhook(body, { 'x-signature': sign(body) })).toEqual({
      kind: 'ignored',
      reason: 'event subscription.cancelled',
    });
  });

  it('reports a signed callback it cannot read, naming the fields only', () => {
    const notJson = Buffer.from('{oops');
    expect(createProvider().parseWebhook(notJson, { 'x-signature': sign(notJson) })).toEqual({ kind: 'malformed', reason: 'invalid JSON' });

    const noOrder = Buffer.from(JSON.stringify({ id: PAYMENT_ID, status: 'PAID' }));
    const result = createProvider().parseWebhook(noOrder, { 'x-signature': sign(noOrder) });
    expect(result.kind).toBe('malformed');
    expect(result.kind === 'malformed' && result.reason).toMatch(/order_id/);
  });
});
