import type { AppDto, MeDto, OrderDto } from '@istock/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ROUTER_FUTURE } from '../lib/router';

export function renderWithProviders(
  element: ReactElement,
  { route = '/', path = '/' }: { route?: string; path?: string } = {},
): RenderResult & { client: QueryClient } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]} future={ROUTER_FUTURE}>
        <Routes>
          <Route path={path} element={element} />
          <Route path="*" element={<div data-testid="navigated" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, client };
}

export const ME: MeDto = {
  user: { id: 42, firstName: 'Иван', username: 'ivan', photoUrl: null },
  isSubscribed: true,
  channelUrl: 'https://t.me/test_channel',
  supportUrl: 'https://t.me/support',
  termsUrl: null,
  channel: { title: 'AppDrop', subscriberCount: 42_800 },
};

export const SBER: AppDto = {
  id: 'sberbank',
  name: 'СберБанк Онлайн',
  subtitle: 'Официальный клиент',
  iconUrl: 'https://example.com/sber.png',
  categoryId: 'finance',
  priceKopecks: 34900,
  version: '15.8.0',
  minIos: '14.0',
};

export function makeOrder(overrides: Partial<OrderDto> = {}): OrderDto {
  return {
    id: 7,
    status: 'paid',
    app: { id: SBER.id, name: SBER.name, iconUrl: SBER.iconUrl },
    amountKopecks: 34900,
    paymentMethod: 'SBP',
    paymentUrl: null,
    expiresAt: null,
    createdAt: '2026-10-14T12:00:00.000Z',
    paidAt: '2026-10-14T12:01:00.000Z',
    completedAt: null,
    ...overrides,
  };
}
