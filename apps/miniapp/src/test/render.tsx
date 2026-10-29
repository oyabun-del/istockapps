import type { AppDto, MeDto, OrderDto, SellerDto } from '@istock/shared';
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

export const SELLER: SellerDto = {
  name: 'ИП Иванов Иван Иванович',
  inn: '500100732259',
  ogrnip: '304500116000157',
  email: 'shop@example.com',
};

export const ME: MeDto = {
  user: { id: 42, firstName: 'Иван', username: 'ivan', photoUrl: null },
  isSubscribed: true,
  channelUrl: 'https://t.me/test_channel',
  supportUrl: 'https://t.me/support',
  seller: SELLER,
  channel: { title: 'iStockApps', subscriberCount: 42_800 },
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

export function makeApp(id: string, name: string, priceKopecks = 19900): AppDto {
  return { ...SBER, id, name, priceKopecks, iconUrl: `https://example.com/${id}.png` };
}

export function makeOrder(overrides: Partial<OrderDto> = {}): OrderDto {
  return {
    id: 7,
    status: 'paid',
    items: [{ id: SBER.id, name: SBER.name, iconUrl: SBER.iconUrl, priceKopecks: 34900, discountKopecks: 0 }],
    subtotalKopecks: 34900,
    discountKopecks: 0,
    amountKopecks: 34900,
    paymentMethod: 'SBP',
    paymentUrl: null,
    expiresAt: null,
    createdAt: '2026-10-14T12:00:00.000Z',
    isCodeReceived: false,
    paidAt: '2026-10-14T12:01:00.000Z',
    completedAt: null,
    ...overrides,
  };
}

/** Three apps bought together with the 100 ₽ per app discount; the invoice expired. */
export const MULTI_ORDER: OrderDto = makeOrder({
  id: 8,
  status: 'expired',
  paidAt: null,
  items: [
    { id: SBER.id, name: SBER.name, iconUrl: SBER.iconUrl, priceKopecks: 34900, discountKopecks: 10000 },
    { id: 'tbank', name: 'Т-Банк', iconUrl: 'https://example.com/tbank.png', priceKopecks: 19900, discountKopecks: 10000 },
    { id: 'canva', name: 'Canva', iconUrl: 'https://example.com/canva.png', priceKopecks: 19900, discountKopecks: 10000 },
  ],
  subtotalKopecks: 74700,
  discountKopecks: 30000,
  amountKopecks: 44700,
});
