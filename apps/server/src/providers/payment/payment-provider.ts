import type { PaymentMethod } from '@istock/shared';

/** NEEDS_REVIEW: the money is held or partly returned; a person decides what happens to the order. */
export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'REFUNDED' | 'NEEDS_REVIEW';

export interface CreatePaymentInput {
  /** Our unique order reference (Order.paymentOrderId). */
  orderId: string;
  amountKopecks: number;
  method: PaymentMethod;
  customerId: string;
  description: string;
  successUrl: string;
  failUrl: string;
}

export interface CreatedPayment {
  paymentId: string;
  paymentUrl: string;
}

export interface PaymentState {
  paymentId: string;
  orderId: string;
  status: PaymentStatus;
  /** Amount in rubles' kopecks, whatever currency the provider settled in. */
  amountKopecks: number;
  /** Test payment or a payment from a blocked buyer: no real money was received. */
  isSandbox: boolean;
}

export interface PaymentWebhook extends Omit<PaymentState, 'amountKopecks'> {
  /** null: status and amount are confirmed via getPayment instead of being taken from the webhook. */
  amountKopecks: number | null;
}

export interface PaymentProvider {
  /** Methods currently enabled for the shop. */
  listMethods(): Promise<PaymentMethod[]>;
  createPayment(input: CreatePaymentInput): Promise<CreatedPayment>;
  getPayment(paymentId: string): Promise<PaymentState>;
  /** Verifies the signature and parses the body. Returns null when the webhook must be rejected. */
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): PaymentWebhook | null;
}

export class PaymentProviderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PaymentProviderError';
  }
}
