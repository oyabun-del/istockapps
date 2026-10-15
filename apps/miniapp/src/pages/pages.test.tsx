import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../lib/api';
import { queryKeys } from '../lib/queries';
import { ME, SBER, makeOrder, renderWithProviders } from '../test/render';
import { AppPage } from './app/AppPage';
import { CatalogPage } from './catalog/CatalogPage';
import { DownloadsPage } from './downloads/DownloadsPage';
import { GuidePage } from './guide/GuidePage';
import { ProfilePage } from './profile/ProfilePage';
import { TicketPage } from './support/TicketPage';

const CATEGORIES = [
  { id: 'all', title: 'Все', icon: 'grid_view' },
  { id: 'games', title: 'Игры', icon: 'sports_esports' },
];

describe('CatalogPage', () => {
  it('lists apps with prices and filters by category', async () => {
    vi.spyOn(api, 'categories').mockResolvedValue(CATEGORIES);
    const apps = vi.spyOn(api, 'apps').mockResolvedValue([SBER]);

    renderWithProviders(<CatalogPage />);

    expect(await screen.findByText('СберБанк Онлайн')).toBeInTheDocument();
    expect(screen.getByText('349 ₽')).toBeInTheDocument();
    expect(screen.getByText('1 приложение')).toBeInTheDocument();

    await userEvent.click(await screen.findByRole('tab', { name: /Игры/ }));
    await waitFor(() => expect(apps).toHaveBeenLastCalledWith({ q: undefined, category: 'games' }));
  });

  it('shows an empty state and resets filters', async () => {
    vi.spyOn(api, 'categories').mockResolvedValue(CATEGORIES);
    vi.spyOn(api, 'apps').mockResolvedValue([]);

    renderWithProviders(<CatalogPage />);
    await userEvent.type(screen.getByLabelText('Поиск приложений'), 'zzz');

    expect(await screen.findByText('Ничего не нашли')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Сбросить фильтры'));
    expect(screen.getByLabelText('Поиск приложений')).toHaveValue('');
  });

  it('shows errors with retry', async () => {
    vi.spyOn(api, 'categories').mockResolvedValue([]);
    const apps = vi.spyOn(api, 'apps').mockRejectedValue(new ApiError('CATALOG_PROVIDER_ERROR', 'Каталог недоступен', 502));

    renderWithProviders(<CatalogPage />);

    expect(await screen.findByText('Каталог недоступен')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Повторить/ }));
    expect(apps).toHaveBeenCalledTimes(2);
  });
});

describe('AppPage', () => {
  it('creates an order with the chosen method and opens the payment page', async () => {
    vi.spyOn(api, 'app').mockResolvedValue(SBER);
    vi.spyOn(api, 'paymentMethods').mockResolvedValue([
      { method: 'SBP', minAmountKopecks: null },
      { method: 'CARD', minAmountKopecks: 5000 },
    ]);
    const createOrder = vi
      .spyOn(api, 'createOrder')
      .mockResolvedValue(makeOrder({ status: 'awaiting_payment', paymentUrl: 'https://pay.example.com/1' }));
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    renderWithProviders(<AppPage />, { route: '/apps/sberbank', path: '/apps/:appId' });

    await userEvent.click(await screen.findByRole('button', { name: /Карта РФ/ }));
    await userEvent.click(screen.getByRole('button', { name: /Оплатить 349 ₽/ }));

    await waitFor(() => expect(createOrder).toHaveBeenCalledWith({ appId: 'sberbank', paymentMethod: 'CARD' }));
    expect(open).toHaveBeenCalledWith('https://pay.example.com/1', '_blank', 'noopener,noreferrer');
    expect(await screen.findByTestId('navigated')).toBeInTheDocument();
  });

  it('hides methods below their minimum and shows checkout errors', async () => {
    vi.spyOn(api, 'app').mockResolvedValue({ ...SBER, priceKopecks: 3000 });
    vi.spyOn(api, 'paymentMethods').mockResolvedValue([
      { method: 'SBP', minAmountKopecks: null },
      { method: 'CARD', minAmountKopecks: 5000 },
    ]);
    vi.spyOn(api, 'createOrder').mockRejectedValue(new ApiError('PAYMENT_PROVIDER_ERROR', 'Не удалось создать платёж', 502));

    renderWithProviders(<AppPage />, { route: '/apps/sberbank', path: '/apps/:appId' });

    expect(await screen.findByRole('button', { name: /СБП/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Карта РФ/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Оплатить/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось создать платёж');
  });
});

describe('DownloadsPage', () => {
  it('lists orders with status badges', async () => {
    vi.spyOn(api, 'orders').mockResolvedValue([makeOrder({ status: 'completed' }), makeOrder({ id: 8, status: 'awaiting_payment' })]);
    renderWithProviders(<DownloadsPage />);
    expect(await screen.findByText('Активировано')).toBeInTheDocument();
    expect(screen.getByText('Ожидает оплаты')).toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    vi.spyOn(api, 'orders').mockResolvedValue([]);
    renderWithProviders(<DownloadsPage />);
    expect(await screen.findByText('Покупок пока нет')).toBeInTheDocument();
  });
});

describe('ProfilePage', () => {
  it('shows purchase stats and support actions', async () => {
    vi.spyOn(api, 'orders').mockResolvedValue([makeOrder({ status: 'completed' }), makeOrder({ id: 8, status: 'failed' })]);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { client } = renderWithProviders(<ProfilePage />);
    client.setQueryData(queryKeys.me, ME);

    await waitFor(() => expect(screen.getByText(/Покупок:/)).toHaveTextContent('Покупок: 1, активировано: 1'));
    await userEvent.click(await screen.findByRole('button', { name: /Поддержка/ }));
    expect(open).toHaveBeenCalledWith('https://t.me/support', '_blank', 'noopener,noreferrer');
  });
});

describe('TicketPage', () => {
  it('submits a ticket linked to the order from the URL', async () => {
    vi.spyOn(api, 'orders').mockResolvedValue([makeOrder()]);
    const createTicket = vi.spyOn(api, 'createTicket').mockResolvedValue({ id: 3, createdAt: '2026-10-14T12:00:00Z' });

    renderWithProviders(<TicketPage />, { route: '/support?order=7', path: '/support' });

    const submit = screen.getByRole('button', { name: /Отправить/ });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox'), 'Не приходит код');
    await userEvent.click(submit);

    await waitFor(() => expect(createTicket).toHaveBeenCalledWith({ message: 'Не приходит код', orderId: 7 }));
    expect(await screen.findByText('Обращение #3 отправлено')).toBeInTheDocument();
  });
});

describe('GuidePage', () => {
  it('renders activation steps and FAQ', () => {
    renderWithProviders(<GuidePage />);
    expect(screen.getByText('Как активировать приложение')).toBeInTheDocument();
    expect(screen.getByText('Код не приходит')).toBeInTheDocument();
    expect(screen.getByText(/Никогда не входите с этими данными в iCloud/)).toBeInTheDocument();
  });
});
