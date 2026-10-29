import type { ErrorCode } from '@istock/shared';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  NOT_SUBSCRIBED: 403,
  SUBSCRIPTION_CHECK_FAILED: 503,
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  INVALID_STATE: 409,
  PAYMENT_METHOD_UNAVAILABLE: 400,
  PAYMENT_PROVIDER_ERROR: 502,
  DELIVERY_PROVIDER_ERROR: 502,
  CATALOG_PROVIDER_ERROR: 502,
  PRICE_CHANGED: 409,
  PAYMENTS_CLOSED: 403,
  PROMO_INVALID: 400,
  PROMO_LIMIT_REACHED: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_ERROR: 500,
};

/** Error safe to show to the client: `message` must never contain internals. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = STATUS_BY_CODE[code];
  }
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Unexpected error';
}
