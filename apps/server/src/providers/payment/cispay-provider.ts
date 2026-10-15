import { createHmac, timingSafeEqual } from 'node:crypto';
import { PAYMENT_METHODS, type PaymentMethod } from '@istock/shared';
import { z } from 'zod';
import {
  PaymentProviderError,
  type CreatePaymentInput,
  type CreatedPayment,
  type PaymentProvider,
  type PaymentState,
  type PaymentWebhook,
} from './payment-provider.js';

/** Spec: docs/cispay-openapi.json */
const REQUEST_TIMEOUT_MS = 10_000;
const CAPABILITIES_TTL_MS = 5 * 60 * 1000;
const SIGNATURE_HEADER = 'x-signature';

const statusSchema = z.enum(['PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED']);

const paymentResponseSchema = z.object({
  id: z.string(),
  order_id: z.string(),
  status: statusSchema,
  amount: z.number().int(),
  payment_url: z.string().nullish(),
});

const capabilitiesSchema = z.object({
  is_active: z.boolean(),
  payment_methods: z.array(z.object({ payment_method: z.string(), is_active: z.boolean() })),
});

const webhookSchema = z.object({
  id: z.string(),
  order_id: z.string(),
  status: statusSchema,
  amount: z.number().int(),
  is_sandbox: z.boolean().default(false),
});

export interface CisPayConfig {
  apiUrl: string;
  shopId: string;
  apiKey: string;
  fetchFn?: typeof fetch;
  now?: () => number;
}

export function signCisPayBody(apiKey: string, rawBody: Buffer | string): string {
  return createHmac('sha256', apiKey).update(rawBody).digest('hex');
}

export function verifyCisPaySignature(apiKey: string, rawBody: Buffer, signature: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = Buffer.from(signCisPayBody(apiKey, rawBody), 'hex');
  const actual = Buffer.from(signature, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function isPaymentMethod(value: string): value is PaymentMethod {
  return (PAYMENT_METHODS as readonly string[]).includes(value);
}

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export class CisPayProvider implements PaymentProvider {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private capabilitiesCache: { methods: PaymentMethod[]; expiresAt: number } | null = null;

  constructor(private readonly config: CisPayConfig) {
    this.fetchFn = config.fetchFn ?? fetch;
    this.now = config.now ?? Date.now;
  }

  async listMethods(): Promise<PaymentMethod[]> {
    const cached = this.capabilitiesCache;
    if (cached && cached.expiresAt > this.now()) return cached.methods;

    const body = capabilitiesSchema.parse(await this.request('GET', '/store/capabilities'));
    const methods = body.is_active
      ? body.payment_methods
          .filter((item) => item.is_active)
          .map((item) => item.payment_method)
          .filter(isPaymentMethod)
      : [];
    this.capabilitiesCache = { methods, expiresAt: this.now() + CAPABILITIES_TTL_MS };
    return methods;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
    const body = paymentResponseSchema.parse(
      await this.request('POST', '/payments', {
        amount: input.amountKopecks,
        currency: 'RUB',
        order_id: input.orderId,
        payment_method: input.method,
        customer_id: input.customerId,
        description: input.description,
        redirect_success_url: input.successUrl,
        redirect_fail_url: input.failUrl,
      }),
    );
    if (!body.payment_url?.startsWith('https://')) {
      throw new PaymentProviderError('CISPAY returned no https payment_url');
    }
    return { paymentId: body.id, paymentUrl: body.payment_url };
  }

  async getPayment(paymentId: string): Promise<PaymentState> {
    const query = new URLSearchParams({ id: paymentId });
    const body = paymentResponseSchema.parse(await this.request('GET', `/payments/status?${query}`));
    return { paymentId: body.id, orderId: body.order_id, status: body.status, amountKopecks: body.amount };
  }

  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): PaymentWebhook | null {
    const signature = headerValue(headers[SIGNATURE_HEADER]);
    if (!signature || !verifyCisPaySignature(this.config.apiKey, rawBody, signature)) return null;

    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return null;
    }
    const parsed = webhookSchema.safeParse(json);
    if (!parsed.success) return null;
    return {
      paymentId: parsed.data.id,
      orderId: parsed.data.order_id,
      status: parsed.data.status,
      amountKopecks: parsed.data.amount,
      isSandbox: parsed.data.is_sandbox,
    };
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.config.apiUrl}${path}`, {
        method,
        headers: {
          'X-Shop-ID': this.config.shopId,
          'X-Api-Key': this.config.apiKey,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error: unknown) {
      throw new PaymentProviderError(`CISPAY ${method} ${path} network error`, { cause: error });
    }

    const text = await response.text();
    if (!response.ok) {
      // Body may describe validation errors; it never contains our secrets.
      throw new PaymentProviderError(`CISPAY ${method} ${path} failed: ${response.status} ${text.slice(0, 500)}`);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch (error: unknown) {
      throw new PaymentProviderError(`CISPAY ${method} ${path} returned invalid JSON`, { cause: error });
    }
  }
}
