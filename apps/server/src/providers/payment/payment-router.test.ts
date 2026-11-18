import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '../../lib/logger.js';
import { MockPaymentProvider } from './mock-payment-provider.js';
import { PaymentProviderError, type CreatePaymentInput } from './payment-provider.js';
import { PaymentRouter } from './payment-router.js';

const INPUT: CreatePaymentInput = {
  orderId: 'ord-1',
  amountKopecks: 34900,
  method: 'SBP',
  customerId: '42',
  description: 'заказ #1',
  successUrl: 'https://t.me/bot',
  failUrl: 'https://t.me/bot',
};

function setup() {
  const sbp = new MockPaymentProvider('https://sbp.example.com');
  const card = new MockPaymentProvider('https://card.example.com');
  const router = new PaymentRouter(
    [
      { name: 'platega', methods: ['SBP'], provider: sbp },
      { name: 'cispay', methods: ['CARD'], provider: card },
    ],
    silentLogger,
  );
  return { sbp, card, router };
}

describe('PaymentRouter', () => {
  it('opens each payment at the provider of its method and asks that provider for its status', async () => {
    const { sbp, card, router } = setup();

    const sbpPayment = await router.createPayment(INPUT);
    const cardPayment = await router.createPayment({ ...INPUT, orderId: 'ord-2', method: 'CARD' });

    expect(sbpPayment.paymentUrl).toContain('sbp.example.com');
    expect(cardPayment.paymentUrl).toContain('card.example.com');
    expect((await router.getPayment(cardPayment.paymentId, 'CARD')).orderId).toBe('ord-2');
    // The SBP provider never saw the card payment.
    await expect(router.getPayment(cardPayment.paymentId, 'SBP')).rejects.toBeInstanceOf(PaymentProviderError);
    expect(await sbp.getPayment(sbpPayment.paymentId)).toBeDefined();
    expect(await card.getPayment(cardPayment.paymentId)).toBeDefined();
  });

  it('refuses a method no provider takes', async () => {
    const { router } = setup();
    await expect(router.createPayment({ ...INPUT, method: 'CRYPTO' })).rejects.toThrow(/No payment provider for CRYPTO/);
  });

  it("lists each provider's own methods only", async () => {
    // Both mocks claim SBP, CARD and CRYPTO.
    expect(await setup().router.listMethods()).toEqual(['SBP', 'CARD']);
  });

  it('keeps the methods of a working provider when another one is down', async () => {
    const { card, router } = setup();
    vi.spyOn(card, 'listMethods').mockRejectedValue(new Error('down'));
    expect(await router.listMethods()).toEqual(['SBP']);
  });

  it('fails when every provider is down', async () => {
    const { sbp, card, router } = setup();
    vi.spyOn(sbp, 'listMethods').mockRejectedValue(new Error('down'));
    vi.spyOn(card, 'listMethods').mockRejectedValue(new Error('down'));
    await expect(router.listMethods()).rejects.toBeInstanceOf(PaymentProviderError);
  });

  it('does not let two providers take one method', () => {
    const provider = new MockPaymentProvider('https://x.example.com');
    expect(
      () =>
        new PaymentRouter(
          [
            { name: 'a', methods: ['SBP'], provider },
            { name: 'b', methods: ['SBP'], provider },
          ],
          silentLogger,
        ),
    ).toThrow(/two providers/);
  });
});
