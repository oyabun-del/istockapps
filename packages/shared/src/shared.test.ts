import { describe, expect, it } from 'vitest';
import { formatRub, isPaidStatus, isTerminalStatus, rubToKopecks } from './index.js';
import { createOrderSchema, createTicketSchema } from './schemas.js';

describe('formatRub', () => {
  it('formats whole rubles without fraction', () => {
    expect(formatRub(34900)).toBe('349 ₽');
  });

  it('formats fractional amounts with two digits', () => {
    expect(formatRub(34950)).toBe('349,50 ₽');
  });

  it('groups thousands with a regular space', () => {
    expect(formatRub(1_234_500)).toBe('12 345 ₽');
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
  it('rejects unknown payment methods', () => {
    const result = createOrderSchema.safeParse({ appId: 'sber', paymentMethod: 'TPAY' });
    expect(result.success).toBe(false);
  });

  it('trims ticket message and enforces minimum length', () => {
    expect(createTicketSchema.safeParse({ message: '   hi   ' }).success).toBe(false);
    const ok = createTicketSchema.safeParse({ message: '  Не приходит код  ' });
    expect(ok.success && ok.data.message).toBe('Не приходит код');
  });
});
