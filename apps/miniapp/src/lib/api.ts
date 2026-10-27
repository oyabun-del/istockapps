import type {
  ApiResponse,
  AppDto,
  CatalogQuery,
  CategoryDto,
  CodeWaitDto,
  CreateOrderInput,
  CreateTicketInput,
  CredentialsDto,
  DeliveryDto,
  ErrorCode,
  MeDto,
  OrderDto,
  PaymentMethodDto,
  SubscriptionDto,
  TicketDto,
} from '@istock/shared';
import { getInitData } from './telegram';

export type ClientErrorCode = ErrorCode | 'NETWORK_ERROR' | 'BAD_RESPONSE';

export class ApiError extends Error {
  constructor(
    readonly code: ClientErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
const NETWORK_MESSAGE = 'Нет соединения с сервером. Проверьте интернет.';

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const initData = getInitData();
  if (initData) headers.Authorization = `tma ${initData}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('NETWORK_ERROR', NETWORK_MESSAGE, 0);
  }

  let payload: ApiResponse<T>;
  try {
    payload = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new ApiError('BAD_RESPONSE', 'Сервер вернул некорректный ответ', response.status);
  }

  if (!payload.success) {
    throw new ApiError(payload.error.code, payload.error.message, response.status);
  }
  return payload.data;
}

function toQuery(params: CatalogQuery): string {
  const entries = Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1]));
  return entries.length ? `?${new URLSearchParams(entries)}` : '';
}

export const api = {
  me: () => request<MeDto>('GET', '/me'),
  checkSubscription: () => request<SubscriptionDto>('POST', '/me/subscription/check'),

  categories: () => request<CategoryDto[]>('GET', '/catalog/categories'),
  apps: (query: CatalogQuery) => request<AppDto[]>('GET', `/catalog/apps${toQuery(query)}`),
  app: (appId: string) => request<AppDto>('GET', `/catalog/apps/${encodeURIComponent(appId)}`),
  paymentMethods: () => request<PaymentMethodDto[]>('GET', '/payment-methods'),

  createOrder: (input: CreateOrderInput) => request<OrderDto>('POST', '/orders', input),
  orders: () => request<OrderDto[]>('GET', '/orders'),
  order: (id: number) => request<OrderDto>('GET', `/orders/${id}`),
  cancelOrder: (id: number) => request<OrderDto>('POST', `/orders/${id}/cancel`),
  delivery: (id: number) => request<DeliveryDto>('GET', `/orders/${id}/delivery`),
  confirmDownload: (id: number) => request<OrderDto>('POST', `/orders/${id}/confirm-download`),
  credentials: (id: number) => request<CredentialsDto>('POST', `/orders/${id}/credentials`),
  startCode: (id: number, groupId: string) => request<CodeWaitDto>('POST', `/orders/${id}/code`, { groupId }),
  codeWait: (id: number, waitId: string) =>
    request<CodeWaitDto>('GET', `/orders/${id}/code/${encodeURIComponent(waitId)}`),
  complete: (id: number) => request<OrderDto>('POST', `/orders/${id}/complete`),

  createTicket: (input: CreateTicketInput) => request<TicketDto>('POST', '/tickets', input),
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Что-то пошло не так. Попробуйте ещё раз.';
}
