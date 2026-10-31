import { describe, expect, it, vi } from 'vitest';
import { PaymentProviderError, type CreatePaymentInput } from './payment-provider.js';
import { PlategaProvider } from './platega-provider.js';

const MERCHANT_ID = '0192a4b8-0000-7000-8000-000000000001';
const SECRET = 'platega-secret';
const TRANSACTION_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const AUTH_HEADERS = { 'x-merchantid': MERCHANT_ID, 'x-secret': SECRET };

const INPUT: CreatePaymentInput = {
  orderId: 'ord-1',
  amountKopecks: 34950,
  method: 'SBP',
  customerId: '42',
  description: 'СберБанк, заказ #1',
  successUrl: 'https://t.me/bot?start=1',
  failUrl: 'https://t.me/bot?start=2',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function createProvider(fetchFn: typeof fetch = vi.fn<typeof fetch>()) {
  return new PlategaProvider({ apiUrl: 'https://app.platega.io', merchantId: MERCHANT_ID, secret: SECRET, fetchFn });
}

function callback(fields: Record<string, unknown> = {}): Buffer {
  return Buffer.from(
    JSON.stringify({
      id: TRANSACTION_ID,
      amount: 1500.25,
      currency: 'RUB',
      status: 'CONFIRMED',
      paymentMethod: 2,
      payload: 'ord-1',
      ...fields,
    }),
  );
}

describe('PlategaProvider.createPayment', () => {
  it('sends the amount in rubles for SBP, identifies the buyer and returns the payment url', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        paymentMethod: 'SBPQR',
        transactionId: TRANSACTION_ID,
        redirect: 'https://pay.platega.io?qrsbp',
        paymentDetails: '349.50 RUB',
        status: 'PENDING',
        expiresIn: '00:15:00',
      }),
    );

    const result = await createProvider(fetchFn).createPayment(INPUT);

    expect(result).toEqual({ paymentId: TRANSACTION_ID, paymentUrl: 'https://pay.platega.io?qrsbp' });
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('https://app.platega.io/transaction/process');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ 'X-MerchantId': MERCHANT_ID, 'X-Secret': SECRET });
    expect(JSON.parse(String(init?.body))).toEqual({
      paymentMethod: 2,
      paymentDetails: { amount: 349.5, currency: 'RUB' },
      description: 'СберБанк, заказ #1',
      return: 'https://t.me/bot?start=1',
      failedUrl: 'https://t.me/bot?start=2',
      payload: 'ord-1',
      metadata: { user_email: '42@telegram.org', userId: '42' },
    });
  });

  it('refuses methods other than SBP without calling the API', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    await expect(createProvider(fetchFn).createPayment({ ...INPUT, method: 'CARD' })).rejects.toBeInstanceOf(
      PaymentProviderError,
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('wraps HTTP errors', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"code":"Auth:GEN_1001"}', { status: 401 }));
    await expect(createProvider(fetchFn).createPayment(INPUT)).rejects.toThrow(/failed: 401/);
  });

  it('wraps network errors and invalid JSON', async () => {
    const network = vi.fn<typeof fetch>().mockRejectedValue(new Error('ECONNRESET'));
    await expect(createProvider(network).getPayment('p')).rejects.toBeInstanceOf(PaymentProviderError);

    const garbage = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>', { status: 200 }));
    await expect(createProvider(garbage).getPayment('p')).rejects.toThrow(/invalid JSON/);
  });

  it('fails when Platega returns no https payment url', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ transactionId: TRANSACTION_ID, redirect: 'http://pay.platega.io' }));
    await expect(createProvider(fetchFn).createPayment(INPUT)).rejects.toThrow(/no https redirect/);
  });
});

describe('PlategaProvider.getPayment', () => {
  function statusResponse(fields: Record<string, unknown> = {}) {
    return jsonResponse({
      id: TRANSACTION_ID,
      status: 'CONFIRMED',
      paymentDetails: { amount: 349.9, currency: 'RUB' },
      payload: 'ord-1',
      ...fields,
    });
  }

  it('reads the status by transaction id and converts the amount to kopecks', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(statusResponse());

    const state = await createProvider(fetchFn).getPayment(TRANSACTION_ID);

    expect(state).toEqual({
      paymentId: TRANSACTION_ID,
      orderId: 'ord-1',
      status: 'PAID',
      amountKopecks: 34990,
      isSandbox: false,
    });
    expect(fetchFn.mock.calls[0]?.[0]).toBe(`https://app.platega.io/transaction/${TRANSACTION_ID}`);
  });

  it('refuses a payment that is not in rubles', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(statusResponse({ paymentDetails: { amount: 5, currency: 'USD' } }));
    await expect(createProvider(fetchFn).getPayment(TRANSACTION_ID)).rejects.toThrow(/USD/);
  });

  it('treats a status it does not know as still pending', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(statusResponse({ status: 'SOMETHING_NEW' }));
    expect((await createProvider(fetchFn).getPayment(TRANSACTION_ID)).status).toBe('PENDING');
  });
});

describe('PlategaProvider.listMethods', () => {
  it('offers SBP without calling the API, which has no such method', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    expect(await createProvider(fetchFn).listMethods()).toEqual(['SBP']);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('Platega callbacks', () => {
  it('parses an authenticated callback and converts the amount without float errors', () => {
    expect(createProvider().parseWebhook(callback({ status: 'CANCELED' }), AUTH_HEADERS)).toEqual({
      paymentId: TRANSACTION_ID,
      orderId: 'ord-1',
      status: 'FAILED',
      amountKopecks: 150025,
      isSandbox: false,
    });
  });

  it('leaves a confirmed payment to be checked through the API', () => {
    const parsed = createProvider().parseWebhook(callback(), AUTH_HEADERS);
    expect(parsed).toMatchObject({ status: 'PAID', amountKopecks: null });
  });

  it('accepts empty optional fields sent as null', () => {
    const parsed = createProvider().parseWebhook(
      callback({ status: 'CANCELED', payload: null, refundStatus: null }),
      AUTH_HEADERS,
    );
    expect(parsed).toMatchObject({ orderId: '', status: 'FAILED' });
  });

  it.each([
    ['CANCELED', {}, 'FAILED'],
    ['CHARGEBACKED', {}, 'REFUNDED'],
    ['CHARGEBACKED', { refundStatus: 'Succeeded' }, 'REFUNDED'],
    ['CHARGEBACKED', { refundStatus: 'Declined' }, 'PENDING'],
    ['DISPUTED', {}, 'NEEDS_REVIEW'],
    ['PARTIALLY_REFUNDED', { refundStatus: 'Succeeded' }, 'NEEDS_REVIEW'],
    ['PARTIALLY_REFUNDED', { refundStatus: 'Declined' }, 'PENDING'],
    ['SUBSCRIPTION_ACTIVATED', {}, 'PENDING'],
  ])('maps %s %j to %s', (status, fields, expected) => {
    expect(createProvider().parseWebhook(callback({ status, ...fields }), AUTH_HEADERS)?.status).toBe(expected);
  });

  it('accepts a callback without a payload, such as one about a subscription', () => {
    const { payload: _omit, ...withoutPayload } = JSON.parse(callback().toString()) as Record<string, unknown>;
    const parsed = createProvider().parseWebhook(Buffer.from(JSON.stringify(withoutPayload)), AUTH_HEADERS);
    expect(parsed?.orderId).toBe('');
  });

  it('leaves the amount unknown when the callback is not in rubles', () => {
    const parsed = createProvider().parseWebhook(callback({ status: 'CANCELED', currency: 'USD' }), AUTH_HEADERS);
    expect(parsed?.amountKopecks).toBeNull();
  });

  it('rejects callbacks with a wrong or missing secret or merchant id', () => {
    const provider = createProvider();
    expect(provider.parseWebhook(callback(), {})).toBeNull();
    expect(provider.parseWebhook(callback(), { ...AUTH_HEADERS, 'x-secret': 'wrong' })).toBeNull();
    expect(provider.parseWebhook(callback(), { ...AUTH_HEADERS, 'x-secret': undefined })).toBeNull();
    expect(provider.parseWebhook(callback(), { ...AUTH_HEADERS, 'x-merchantid': 'other' })).toBeNull();
  });

  it('rejects malformed bodies', () => {
    const provider = createProvider();
    expect(provider.parseWebhook(Buffer.from('nope'), AUTH_HEADERS)).toBeNull();
    expect(provider.parseWebhook(Buffer.from('{"id":1}'), AUTH_HEADERS)).toBeNull();
  });
});
