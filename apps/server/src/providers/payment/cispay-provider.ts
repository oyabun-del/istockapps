import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PaymentMethod } from '@istock/shared';
import { z } from 'zod';
import {
  PaymentProviderError,
  type CreatePaymentInput,
  type CreatedPayment,
  type PaymentProvider,
  type PaymentState,
  type PaymentStatus,
  type WebhookParseResult,
} from './payment-provider.js';

/** Docs: https://cispay.app/developers (OpenAPI: https://cispay.app/api/merchant/v1/openapi.json). */
const REQUEST_TIMEOUT_MS = 10_000;
const SIGNATURE_HEADER = 'x-signature';
const RUB = 'RUB';
/** Store capabilities change rarely; the cart asks for them on every visit. */
const CAPABILITIES_TTL_MS = 60_000;
/** CisPay refuses longer customer ids (its provider's limit). */
const CUSTOMER_ID_MAX = 40;

const createdPaymentSchema = z.object({ id: z.string(), payment_url: z.string().nullish() });

const paymentStatusSchema = z.object({
  id: z.string(),
  order_id: z.string(),
  status: z.string(),
  amount: z.number().int(),
  currency: z.string(),
  is_sandbox: z.boolean().default(false),
});

const capabilitiesSchema = z.object({
  is_active: z.boolean(),
  payment_methods: z.array(z.object({ payment_method: z.string(), is_active: z.boolean() })),
});

/** Payment callbacks; subscription events carry an `event` field and are told apart before this. */
const callbackSchema = z.object({
  id: z.string(),
  order_id: z.string(),
  status: z.string(),
  is_sandbox: z.boolean().default(false),
});

export interface CispayConfig {
  apiUrl: string;
  shopId: string;
  apiKey: string;
  fetchFn?: typeof fetch;
  now?: () => number;
}

/** PENDING and anything new must not change an order. */
function toPaymentStatus(status: string): PaymentStatus {
  switch (status) {
    case 'PAID':
      return 'PAID';
    case 'FAILED':
      return 'FAILED';
    case 'EXPIRED':
      return 'EXPIRED';
    case 'REFUNDED':
      return 'REFUNDED';
    default:
      return 'PENDING';
  }
}

/** "id: expected string; status: required": field names and messages only, never the values. */
function describeIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
}

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class CispayProvider implements PaymentProvider {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private methodsCache: { methods: PaymentMethod[]; expiresAt: number } | null = null;

  constructor(private readonly config: CispayConfig) {
    this.fetchFn = config.fetchFn ?? fetch;
    this.now = config.now ?? Date.now;
  }

  /** Card only, and only while the store and its card method are active. */
  async listMethods(): Promise<PaymentMethod[]> {
    if (this.methodsCache && this.methodsCache.expiresAt > this.now()) return this.methodsCache.methods;
    const body = capabilitiesSchema.parse(await this.request('GET', '/store/capabilities'));
    const isCardActive =
      body.is_active && body.payment_methods.some((item) => item.payment_method === 'CARD' && item.is_active);
    const methods: PaymentMethod[] = isCardActive ? ['CARD'] : [];
    this.methodsCache = { methods, expiresAt: this.now() + CAPABILITIES_TTL_MS };
    return methods;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
    if (input.method !== 'CARD') throw new PaymentProviderError(`CisPay: unsupported method ${input.method}`);
    const body = createdPaymentSchema.parse(
      await this.request('POST', '/payments', {
        amount: input.amountKopecks,
        currency: RUB,
        // Unique per shop: a second payment for the same order_id is refused, which is what we want.
        order_id: input.orderId,
        payment_method: 'CARD',
        customer_id: input.customerId.slice(0, CUSTOMER_ID_MAX),
        redirect_success_url: input.successUrl,
        redirect_fail_url: input.failUrl,
        description: input.description,
      }),
    );
    if (!body.payment_url?.startsWith('https://')) {
      throw new PaymentProviderError('CisPay returned no https payment url');
    }
    return { paymentId: body.id, paymentUrl: body.payment_url };
  }

  async getPayment(paymentId: string): Promise<PaymentState> {
    const body = paymentStatusSchema.parse(
      await this.request('GET', `/payments/status?id=${encodeURIComponent(paymentId)}`),
    );
    if (body.currency !== RUB) throw new PaymentProviderError(`CisPay payment ${paymentId} is in ${body.currency}`);
    return {
      paymentId: body.id,
      orderId: body.order_id,
      status: toPaymentStatus(body.status),
      // Net amount, as we asked for it; a fee the buyer pays on top is in charged_amount.
      amountKopecks: body.amount,
      isSandbox: body.is_sandbox,
    };
  }

  /**
   * Callbacks are signed: X-Signature is hex HMAC-SHA256 of the raw body keyed with our API key.
   * Even so the amount is not taken from them: the status API is asked, so a delayed retry of an old
   * status cannot undo a newer one and a partial refund is seen as the API reports it.
   */
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): WebhookParseResult {
    if (!this.isSigned(rawBody, headerValue(headers[SIGNATURE_HEADER]))) return { kind: 'unauthorized' };

    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return { kind: 'malformed', reason: 'invalid JSON' };
    }
    // Subscription events: the shop opens no subscriptions, so there is nothing to apply.
    if (isObject(json) && 'event' in json) return { kind: 'ignored', reason: `event ${String(json.event)}` };

    const parsed = callbackSchema.safeParse(json);
    if (!parsed.success) return { kind: 'malformed', reason: describeIssues(parsed.error) };
    return {
      kind: 'accepted',
      webhook: {
        paymentId: parsed.data.id,
        orderId: parsed.data.order_id,
        // For the log only: the API has the final word.
        status: toPaymentStatus(parsed.data.status),
        amountKopecks: null,
        isSandbox: parsed.data.is_sandbox,
      },
    };
  }

  private isSigned(rawBody: Buffer, signature: string | null): boolean {
    if (signature === null || !/^[0-9a-f]{64}$/i.test(signature)) return false;
    const expected = createHmac('sha256', this.config.apiKey).update(rawBody).digest();
    return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const route = path.split('?')[0];
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
      throw new PaymentProviderError(`CisPay ${method} ${route} network error`, { cause: error });
    }

    const text = await response.text();
    if (!response.ok) {
      // The body describes the error (validation details); it never contains our key.
      throw new PaymentProviderError(`CisPay ${method} ${route} failed: ${response.status} ${text.slice(0, 500)}`);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch (error: unknown) {
      throw new PaymentProviderError(`CisPay ${method} ${route} returned invalid JSON`, { cause: error });
    }
  }
}
