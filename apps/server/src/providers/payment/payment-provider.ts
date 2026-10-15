import type { PaymentMethod } from '@istock/shared';

export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'REFUNDED';

export interface CreatePaymentInput {
  /** Our unique order reference (Order.paymentOrderId). */
  orderId: string;
  amountKopecks: number;
  method: PaymentMethod;
  customerId: string;
  description: string;
  successUrl: string | null;
  failUrl: string | null;
}

export interface CreatedPayment {
  paymentId: string;
  paymentUrl: string;
}

export interface PaymentState {
  paymentId: string;
  orderId: string;
  status: PaymentStatus;
  amountKopecks: number;
}

export interface PaymentWebhook extends PaymentState {
  isSandbox: boolean;
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
