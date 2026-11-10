import { createHash, timingSafeEqual } from 'node:crypto';
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

/** Docs: https://docs.platega.io/ */
const REQUEST_TIMEOUT_MS = 10_000;
const MERCHANT_HEADER = 'x-merchantid';
const SECRET_HEADER = 'x-secret';

const RUB = 'RUB';
const KOPECKS_PER_RUBLE = 100;
/** PaymentMethodInt: SBP (QR code). */
const SBP_METHOD_CODE = 2;
/** The shop has no e-mails; Platega asks Telegram shops to identify a buyer by a permanent id on this domain. */
const BUYER_EMAIL_DOMAIN = 'telegram.org';
const REFUND_DECLINED = 'Declined';

const createdPaymentSchema = z.object({ transactionId: z.string(), redirect: z.string().nullish() });

const paymentResponseSchema = z.object({
  id: z.string(),
  status: z.string(),
  paymentDetails: z.object({ amount: z.number(), currency: z.string() }),
  payload: z.string().nullish(),
});

/**
 * Fields without a value are not sent at all, and events about subscriptions carry no payload.
 * The amount and currency are not read: every callback is checked through the API.
 */
const callbackSchema = z.object({
  id: z.string(),
  status: z.string(),
  payload: z.string().nullish(),
  refundStatus: z.string().nullish(),
});

export interface PlategaConfig {
  apiUrl: string;
  merchantId: string;
  secret: string;
  fetchFn?: typeof fetch;
}

function toKopecks(rubles: number): number {
  return Math.round(rubles * KOPECKS_PER_RUBLE);
}

/** Anything unknown (new statuses, subscription events) must not change an order. */
function toPaymentStatus(status: string, refundStatus?: string | null): PaymentStatus {
  // A declined refund moved no money, whatever status it came with.
  if (refundStatus === REFUND_DECLINED) return 'PENDING';
  switch (status) {
    case 'CONFIRMED':
      return 'PAID';
    case 'CANCELED':
      return 'FAILED';
    case 'CHARGEBACKED':
      return 'REFUNDED';
    case 'DISPUTED':
    case 'PARTIALLY_REFUNDED':
      return 'NEEDS_REVIEW';
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

/** Hashing first gives equal lengths, so the comparison reveals nothing about the expected value. */
function isSameSecret(actual: string | null, expected: string): boolean {
  if (actual === null) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(actual), digest(expected));
}

export class PlategaProvider implements PaymentProvider {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly config: PlategaConfig) {
    this.fetchFn = config.fetchFn ?? fetch;
  }

  /** Platega has no call that lists a merchant's methods: without SBP creating a payment fails. */
  async listMethods(): Promise<PaymentMethod[]> {
    return ['SBP'];
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
    if (input.method !== 'SBP') throw new PaymentProviderError(`Platega: unsupported method ${input.method}`);
    const body = createdPaymentSchema.parse(
      await this.request('POST', '/transaction/process', {
        paymentMethod: SBP_METHOD_CODE,
        paymentDetails: { amount: input.amountKopecks / KOPECKS_PER_RUBLE, currency: RUB },
        description: input.description,
        return: input.successUrl,
        failedUrl: input.failUrl,
        // Comes back in every callback: that is how a callback finds its order.
        payload: input.orderId,
        metadata: { user_email: `${input.customerId}@${BUYER_EMAIL_DOMAIN}`, userId: input.customerId },
      }),
    );
    if (!body.redirect?.startsWith('https://')) {
      throw new PaymentProviderError('Platega returned no https redirect');
    }
    return { paymentId: body.transactionId, paymentUrl: body.redirect };
  }

  async getPayment(paymentId: string): Promise<PaymentState> {
    const body = paymentResponseSchema.parse(
      await this.request('GET', `/transaction/${encodeURIComponent(paymentId)}`),
    );
    const { amount, currency } = body.paymentDetails;
    if (currency !== RUB) throw new PaymentProviderError(`Platega payment ${paymentId} is in ${currency}`);
    return {
      paymentId: body.id,
      orderId: body.payload ?? '',
      status: toPaymentStatus(body.status),
      amountKopecks: toKopecks(amount),
      isSandbox: false,
    };
  }

  /**
   * Callbacks are not signed: Platega proves itself by sending our own merchant id and secret.
   * That secret is also the API key and travels in every callback, so a callback is never taken on its
   * word: with no amount the status and amount are read from the API. A forged "refund" then changes
   * nothing, and a callback delivered after a later chargeback cannot undo it either.
   */
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): WebhookParseResult {
    const isAuthentic =
      isSameSecret(headerValue(headers[MERCHANT_HEADER]), this.config.merchantId) &&
      isSameSecret(headerValue(headers[SECRET_HEADER]), this.config.secret);
    if (!isAuthentic) return { kind: 'unauthorized' };

    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return { kind: 'malformed', reason: 'invalid JSON' };
    }
    const parsed = callbackSchema.safeParse(json);
    if (!parsed.success) return { kind: 'malformed', reason: describeIssues(parsed.error) };
    return {
      kind: 'accepted',
      webhook: {
        paymentId: parsed.data.id,
        orderId: parsed.data.payload ?? '',
        // For the log only: the API has the final word.
        status: toPaymentStatus(parsed.data.status, parsed.data.refundStatus),
        amountKopecks: null,
        isSandbox: false,
      },
    };
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.config.apiUrl}${path}`, {
        method,
        headers: {
          'X-MerchantId': this.config.merchantId,
          'X-Secret': this.config.secret,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error: unknown) {
      throw new PaymentProviderError(`Platega ${method} ${path} network error`, { cause: error });
    }

    const text = await response.text();
    if (!response.ok) {
      // The body describes the error and carries the traceId support asks for; it never contains our secrets.
      throw new PaymentProviderError(`Platega ${method} ${path} failed: ${response.status} ${text.slice(0, 500)}`);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch (error: unknown) {
      throw new PaymentProviderError(`Platega ${method} ${path} returned invalid JSON`, { cause: error });
    }
  }
}
