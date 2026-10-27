import type { OrderStatus } from './order-status.js';

// ---------- Envelope ----------

export interface ApiSuccess<T> {
  success: true;
  data: T;
  error: null;
}

export interface ApiFailure {
  success: false;
  data: null;
  error: { code: ErrorCode; message: string };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export const ERROR_CODES = [
  'UNAUTHORIZED',
  'NOT_SUBSCRIBED',
  'SUBSCRIPTION_CHECK_FAILED',
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'INVALID_STATE',
  'PAYMENT_METHOD_UNAVAILABLE',
  'PAYMENT_PROVIDER_ERROR',
  'DELIVERY_PROVIDER_ERROR',
  'CATALOG_PROVIDER_ERROR',
  'TOO_MANY_REQUESTS',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

// ---------- Payment ----------

/** Methods supported by CISPAY (see docs/cispay-openapi.json); older orders may carry any of them. */
export const PAYMENT_METHODS = ['SBP', 'CARD', 'CRYPTO'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** The shop accepts new payments by SBP only. */
export const ACTIVE_PAYMENT_METHOD = 'SBP' satisfies PaymentMethod;
export type ActivePaymentMethod = typeof ACTIVE_PAYMENT_METHOD;

export interface PaymentMethodDto {
  method: ActivePaymentMethod;
}

// ---------- Catalog ----------

export interface CategoryDto {
  id: string;
  title: string;
  /** Material Symbols icon name; must be listed in apps/miniapp/src/lib/icons.ts, otherwise a fallback is shown. */
  icon: string;
}

export interface AppDto {
  id: string;
  name: string;
  subtitle: string;
  iconUrl: string;
  categoryId: string;
  priceKopecks: number;
  version: string | null;
  minIos: string | null;
}

// ---------- Orders ----------

export interface OrderDto {
  id: number;
  status: OrderStatus;
  app: { id: string; name: string; iconUrl: string };
  amountKopecks: number;
  paymentMethod: PaymentMethod;
  paymentUrl: string | null;
  /** When the unpaid invoice expires (ISO); null once the order is no longer awaiting payment. */
  expiresAt: string | null;
  createdAt: string;
  /** The login code step is done (code received or not asked by Apple); unlocks the last step. */
  isCodeReceived: boolean;
  paidAt: string | null;
  completedAt: string | null;
}

/**
 * available — links work; replacing — the account was blocked and a free replacement is being found;
 * revoked — access was withdrawn for good; expired — the delivery window is over;
 * unavailable — no links right now for another reason.
 */
export const DELIVERY_STATES = ['available', 'replacing', 'revoked', 'expired', 'unavailable'] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

export interface DeliveryAppDto {
  id: string;
  name: string;
  state: DeliveryState;
  /** Only present while the app is available. */
  links: { main: string; reserve: string } | null;
}

/** One Apple account; its apps share login, password and confirmation codes. */
export interface DeliveryGroupDto {
  id: string;
  state: DeliveryState;
  expiresAt: string;
  /** Explanation from the delivery API when access was revoked. */
  message: string | null;
  codesLeft: number;
  apps: DeliveryAppDto[];
}

/** Fresh snapshot of the delivery: always replaces the previous one as a whole. */
export interface DeliveryDto {
  expiresAt: string;
  /** Test mode of the delivery API: nothing is really charged. */
  isSandbox: boolean;
  groups: DeliveryGroupDto[];
  /** Some apps are waiting for a replacement account; the client should poll. */
  isReplacing: boolean;
}

export interface CredentialsDto {
  groups: Array<{ groupId: string; login: string; password: string }>;
}

export const CODE_WAIT_STATUSES = ['active', 'succeeded', 'code_expired', 'timed_out', 'cancelled'] as const;
export type CodeWaitStatus = (typeof CODE_WAIT_STATUSES)[number];

export interface CodeWaitDto {
  id: string;
  groupId: string;
  status: CodeWaitStatus;
  /** Present only while status is "succeeded" and the code is still fresh. */
  code: string | null;
  /** When the code stops working (ISO). */
  codeExpiresAt: string | null;
  /** When the wait for a code ends (ISO). */
  deadlineAt: string | null;
}

export interface StartCodeInput {
  groupId: string;
}

// ---------- User ----------

export interface MeDto {
  user: { id: number; firstName: string; username: string | null; photoUrl: string | null };
  isSubscribed: boolean;
  channelUrl: string;
  supportUrl: string;
  /** Terms of service page, if the shop has published one. */
  termsUrl: string | null;
  /** Unknown values are null (e.g. the bot cannot read the channel). */
  channel: { title: string | null; subscriberCount: number | null };
}

export interface SubscriptionDto {
  isSubscribed: boolean;
}

// ---------- Requests ----------

export interface CatalogQuery {
  q?: string;
  category?: string;
}

export interface CreateOrderInput {
  appId: string;
  paymentMethod: ActivePaymentMethod;
}
