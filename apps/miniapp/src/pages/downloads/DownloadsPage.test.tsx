import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import { cartStore } from '../../lib/cart';
import { MULTI_ORDER, makeOrder, renderWithProviders } from '../../test/render';
import { DownloadsPage } from './DownloadsPage';

const ORDERS = [
  makeOrder({ id: 1, status: 'paid' }),
  makeOrder({
    id: 2,
    status: 'awaiting_payment',
    paymentUrl: 'https://pay.example.com/2',
    expiresAt: new Date(Date.now() + 12 * 60 * 1000).toISOString(),
    paidAt: null,
  }),
  makeOrder({ id: 3, status: 'expired', paidAt: null }),
  makeOrder({ id: 4, status: 'completed' }),
];

function visibleOrders(): (string | null)[] {
  return screen.getAllByRole('article').map((item) => item.getAttribute('aria-label'));
}

function card(orderId: number) {
  return screen.getByRole('article', { name: `Заказ #${orderId}` });
}

describe('DownloadsPage', () => {
  it('splits orders into active and archived tabs with counts', async () => {
    vi.spyOn(api, 'orders').mockResolvedValue(ORDERS);
    renderWithProviders(<DownloadsPage />);

    expect(await screen.findByRole('tab', { name: 'Все (4)' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('article')).toHaveLength(4);

    await userEvent.click(screen.getByRole('tab', { name: 'Активные (2)' }));
    // Cards leaving the list finish their exit animation first.
    await waitFor(() => expect(visibleOrders()).toEqual(['Заказ #1', 'Заказ #2']));

    await userEvent.click(screen.getByRole('tab', { name: 'Архив (2)' }));
    await waitFor(() => expect(visibleOrders()).toEqual(['Заказ #3', 'Заказ #4']));
  });

  it('offers the next action for each order state', async () => {
    vi.spyOn(api, 'orders').mockResolvedValue(ORDERS);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderWithProviders(<DownloadsPage />);

    await screen.findAllByRole('article');
    expect(within(card(1)).getByRole('link', { name: /Продолжить/ })).toHaveAttribute('href', '/orders/1');
    expect(within(card(1)).getByRole('link', { name: /Инструкция/ })).toHaveAttribute('href', '/guide');
    expect(within(card(2)).getByText(/осталось 1[12]:\d\d/)).toBeInTheDocument();

    await userEvent.click(within(card(2)).getByRole('button', { name: 'Оплатить 349\u00a0₽' }));
    expect(open).toHaveBeenCalledWith('https://pay.example.com/2', '_blank', 'noopener,noreferrer');

    await userEvent.click(within(card(3)).getByRole('button', { name: /Оформить заново/ }));
    expect(cartStore.getSnapshot()).toEqual(['sberbank']);
    expect(await screen.findByTestId('navigated')).toBeInTheDocument();
  });

  it('names a multi-app order by its first app and shows the discount', async () => {
    vi.spyOn(api, 'orders').mockResolvedValue([MULTI_ORDER]);
    renderWithProviders(<DownloadsPage />);

    const multi = await screen.findByRole('article', { name: `Заказ #${MULTI_ORDER.id}` });
    expect(within(multi).getByText('СберБанк Онлайн и ещё 2')).toBeInTheDocument();
    expect(within(multi).getByText(/скидка 300 ₽/)).toBeInTheDocument();
  });

  it('teaches what to do when there are no orders yet', async () => {
    vi.spyOn(api, 'orders').mockResolvedValue([]);
    renderWithProviders(<DownloadsPage />);

    expect(await screen.findByText('Покупок пока нет')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Перейти в каталог' })).toHaveAttribute('href', '/');
  });

  it('explains an empty tab', async () => {
    vi.spyOn(api, 'orders').mockResolvedValue([makeOrder({ id: 4, status: 'completed' })]);
    renderWithProviders(<DownloadsPage />);

    await userEvent.click(await screen.findByRole('tab', { name: 'Активные (0)' }));

    expect(screen.getByText('Активных заказов нет')).toBeInTheDocument();
  });
});
