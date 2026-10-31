import { randomUUID } from 'node:crypto';
import type { PaymentMethod } from '@istock/shared';
import {
  PaymentProviderError,
  type CreatePaymentInput,
  type CreatedPayment,
  type PaymentProvider,
  type PaymentState,
  type PaymentStatus,
  type PaymentWebhook,
} from './payment-provider.js';

/**
 * Development stand-in for a payment service. The payment page is served by our own
 * `/dev/mock-pay/:paymentId` route, which marks the payment as PAID.
 */
export class MockPaymentProvider implements PaymentProvider {
  private readonly payments = new Map<string, PaymentState>();

  constructor(private readonly publicUrl: string) {}

  async listMethods(): Promise<PaymentMethod[]> {
    return ['SBP', 'CARD', 'CRYPTO'];
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
    const paymentId = randomUUID();
    this.payments.set(paymentId, {
      paymentId,
      orderId: input.orderId,
      status: 'PENDING',
      amountKopecks: input.amountKopecks,
      // No real money moves, so these count as test payments.
      isSandbox: true,
    });
    return { paymentId, paymentUrl: `${this.publicUrl}/dev/mock-pay/${paymentId}` };
  }

  async getPayment(paymentId: string): Promise<PaymentState> {
    const payment = this.payments.get(paymentId);
    if (!payment) throw new PaymentProviderError(`Unknown mock payment ${paymentId}`);
    return payment;
  }

  /** Mock payments are settled through the dev route, not webhooks. */
  parseWebhook(): PaymentWebhook | null {
    return null;
  }

  setStatus(paymentId: string, status: PaymentStatus): PaymentState | null {
    const payment = this.payments.get(paymentId);
    if (!payment) return null;
    const updated = { ...payment, status };
    this.payments.set(paymentId, updated);
    return updated;
  }
}
