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

/** Methods supported by CISPAY (see docs/cispay-openapi.json). */
export const PAYMENT_METHODS = ['SBP', 'CARD', 'CRYPTO'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface PaymentMethodDto {
  method: PaymentMethod;
  /** Minimum amount in kopecks, null when unlimited. */
  minAmountKopecks: number | null;
}

// ---------- Catalog ----------

export interface CategoryDto {
  id: string;
  title: string;
  /** Material Symbols icon name. */
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
  createdAt: string;
  paidAt: string | null;
  completedAt: string | null;
}

export interface DownloadDto {
  url: string;
}

export interface CredentialsDto {
  login: string;
  password: string;
}

export interface CodeDto {
  code: string;
  /** When the user may request a new code (ISO). */
  nextRequestAt: string;
}

// ---------- User ----------

export interface MeDto {
  user: { id: number; firstName: string; username: string | null; photoUrl: string | null };
  isSubscribed: boolean;
  channelUrl: string;
  supportUrl: string;
}

export interface SubscriptionDto {
  isSubscribed: boolean;
}

export interface TicketDto {
  id: number;
  createdAt: string;
}

// ---------- Limits (shared by client validation and server schemas) ----------

export const TICKET_MESSAGE_MAX = 2000;
export const TICKET_MESSAGE_MIN = 5;

export interface CatalogQuery {
  q?: string;
  category?: string;
}

export interface CreateOrderInput {
  appId: string;
  paymentMethod: PaymentMethod;
}

export interface CreateTicketInput {
  orderId?: number | null;
  message: string;
}
