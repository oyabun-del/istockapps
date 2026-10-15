import { isTerminalStatus, type CatalogQuery, type OrderDto } from '@istock/shared';
import { QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ApiError, api } from './api';

const STALE_TIME_MS = 30_000;
const SERVER_ERROR_MIN = 500;
const MAX_RETRIES = 2;
/** Unpaid orders are polled while the buyer is on the payment page. */
export const ORDER_POLL_MS = 4_000;

export const queryKeys = {
  me: ['me'] as const,
  categories: ['categories'] as const,
  apps: (query: CatalogQuery) => ['apps', query] as const,
  app: (appId: string) => ['app', appId] as const,
  paymentMethods: ['payment-methods'] as const,
  orders: ['orders'] as const,
  order: (id: number) => ['order', id] as const,
  credentials: (id: number) => ['credentials', id] as const,
};

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (!(error instanceof ApiError)) return failureCount < MAX_RETRIES;
  const retriable = error.code === 'NETWORK_ERROR' || error.status >= SERVER_ERROR_MIN;
  return retriable && failureCount < MAX_RETRIES;
}

export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: STALE_TIME_MS, retry: shouldRetry, refetchOnWindowFocus: true },
      mutations: { retry: false },
    },
  });

  // Any NOT_SUBSCRIBED answer (query or action) sends the user back to the subscription gate.
  const recheckSubscription = (error: unknown) => {
    if (error instanceof ApiError && error.code === 'NOT_SUBSCRIBED') {
      void client.invalidateQueries({ queryKey: queryKeys.me });
    }
  };
  client.getQueryCache().subscribe((event) => {
    if (event.type === 'updated') recheckSubscription(event.query.state.error);
  });
  client.getMutationCache().subscribe((event) => {
    if (event.type === 'updated') recheckSubscription(event.mutation?.state.error);
  });
  return client;
}

export function useMe() {
  return useQuery({ queryKey: queryKeys.me, queryFn: api.me, staleTime: Infinity });
}

export function useOrder(id: number) {
  const queryClient = useQueryClient();
  const order = useQuery({
    queryKey: queryKeys.order(id),
    queryFn: () => api.order(id),
    refetchInterval: (query) => {
      const order: OrderDto | undefined = query.state.data;
      return order?.status === 'awaiting_payment' ? ORDER_POLL_MS : false;
    },
  });

  // Keep "Мои загрузки" in sync whenever this order changes status.
  const status = order.data?.status;
  useEffect(() => {
    if (status) void queryClient.invalidateQueries({ queryKey: queryKeys.orders });
  }, [status, queryClient]);

  return order;
}

export function isOrderActive(order: OrderDto): boolean {
  return !isTerminalStatus(order.status);
}
