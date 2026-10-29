import { describe, expect, it } from 'vitest';
import {
  formatRub,
  isPaidStatus,
  isTerminalStatus,
  MAX_ORDER_ITEMS,
  normalizePromoCode,
  PROMO_CODE_PATTERN,
  rubToKopecks,
} from './index.js';
import { appIdParamSchema, createOrderSchema, promoCheckSchema } from './schemas.js';

describe('formatRub', () => {
  it('formats whole rubles without fraction', () => {
    expect(formatRub(34900)).toBe('349\u00a0₽');
  });

  it('formats fractional amounts with two digits', () => {
    expect(formatRub(34950)).toBe('349,50\u00a0₽');
  });

  it('never lets an amount break across lines', () => {
    // "1 250 ₽" split after "1" reads as 250 ₽.
    expect(formatRub(125_000)).toBe('1\u00a0250\u00a0₽');
    expect(formatRub(1_234_500)).toBe('12\u00a0345\u00a0₽');
  });
});

describe('rubToKopecks', () => {
  it('converts rubles to integer kopecks', () => {
    expect(rubToKopecks(199.99)).toBe(19999);
  });
});

describe('order status helpers', () => {
  it('treats delivery statuses as paid', () => {
    expect(isPaidStatus('paid')).toBe(true);
    expect(isPaidStatus('credentials_issued')).toBe(true);
    expect(isPaidStatus('awaiting_payment')).toBe(false);
    expect(isPaidStatus('refunded')).toBe(false);
  });

  it('marks final statuses as terminal', () => {
    expect(isTerminalStatus('completed')).toBe(true);
    expect(isTerminalStatus('expired')).toBe(true);
    expect(isTerminalStatus('paid')).toBe(false);
  });
});

describe('request schemas', () => {
  it('accepts only SBP for new orders', () => {
    expect(createOrderSchema.safeParse({ appIds: ['sber'], paymentMethod: 'SBP' }).success).toBe(true);
    for (const paymentMethod of ['CARD', 'CRYPTO', 'TPAY']) {
      expect(createOrderSchema.safeParse({ appIds: ['sber'], paymentMethod }).success).toBe(false);
    }
  });

  it('accepts catalog-style app ids and rejects path-like ones', () => {
    for (const appId of ['sberbank', 'vtb-invest', 'com.example.app_2', '1234567890']) {
      expect(appIdParamSchema.safeParse({ appId }).success).toBe(true);
      expect(createOrderSchema.safeParse({ appIds: [appId], paymentMethod: 'SBP' }).success).toBe(true);
    }
    for (const appId of ['', '../admin', 'a/b', 'a?b=1', 'a b', 'x'.repeat(129)]) {
      expect(appIdParamSchema.safeParse({ appId }).success).toBe(false);
      expect(createOrderSchema.safeParse({ appIds: [appId], paymentMethod: 'SBP' }).success).toBe(false);
    }
  });

  it('accepts from one to MAX_ORDER_ITEMS distinct apps per order', () => {
    const ids = (count: number) => Array.from({ length: count }, (_, index) => `app-${index}`);

    expect(createOrderSchema.safeParse({ appIds: ids(MAX_ORDER_ITEMS), paymentMethod: 'SBP' }).success).toBe(true);
    expect(createOrderSchema.safeParse({ appIds: [], paymentMethod: 'SBP' }).success).toBe(false);
    expect(createOrderSchema.safeParse({ appIds: ids(MAX_ORDER_ITEMS + 1), paymentMethod: 'SBP' }).success).toBe(false);
    expect(createOrderSchema.safeParse({ appIds: ['sber', 'sber'], paymentMethod: 'SBP' }).success).toBe(false);
  });

  it('accepts an optional non-negative expected total in kopecks', () => {
    const base = { appIds: ['sber'], paymentMethod: 'SBP' };

    expect(createOrderSchema.safeParse({ ...base, expectedTotalKopecks: 34900 }).success).toBe(true);
    for (const expectedTotalKopecks of [-1, 1.5, '34900']) {
      expect(createOrderSchema.safeParse({ ...base, expectedTotalKopecks }).success).toBe(false);
    }
  });

  it('normalizes the promo code of an order and of a promo check', () => {
    const base = { appIds: ['sber'], paymentMethod: 'SBP' };

    expect(createOrderSchema.parse({ ...base, promoCode: '  ios-Review ' }).promoCode).toBe('IOS-REVIEW');
    expect(promoCheckSchema.parse({ code: 'abc_123' }).code).toBe('ABC_123');
    expect(createOrderSchema.safeParse({ ...base, promoCode: 'x'.repeat(65) }).success).toBe(false);
    expect(promoCheckSchema.safeParse({ code: 42 }).success).toBe(false);
  });
});

describe('promo codes', () => {
  it('accepts 6 to 32 latin letters, digits, underscores and dashes after normalizing', () => {
    for (const raw of ['ios-review', 'ABCDEF', ' x_1-y2 ', 'A'.repeat(32)]) {
      expect(PROMO_CODE_PATTERN.test(normalizePromoCode(raw))).toBe(true);
    }
    for (const raw of ['abcde', 'A'.repeat(33), 'промокод', 'a b c d e f', 'code!!']) {
      expect(PROMO_CODE_PATTERN.test(normalizePromoCode(raw))).toBe(false);
    }
  });
});
