import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../lib/api';
import { ME, SBER, makeOrder, renderWithProviders } from '../test/render';
import { AppPage } from './app/AppPage';
import { CatalogPage } from './catalog/CatalogPage';
import { GuidePage } from './guide/GuidePage';

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
  it('pays by SBP and opens the payment page', async () => {
    vi.spyOn(api, 'app').mockResolvedValue(SBER);
    vi.spyOn(api, 'paymentMethods').mockResolvedValue([{ method: 'SBP' }]);
    const createOrder = vi
      .spyOn(api, 'createOrder')
      .mockResolvedValue(makeOrder({ status: 'awaiting_payment', paymentUrl: 'https://pay.example.com/1' }));
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    renderWithProviders(<AppPage />, { route: '/apps/sberbank', path: '/apps/:appId' });

    expect(await screen.findByText('СБП')).toBeInTheDocument();
    expect(screen.queryByText(/Карта РФ|USDT/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Оплатить 349 ₽/ }));

    await waitFor(() => expect(createOrder).toHaveBeenCalledWith({ appId: 'sberbank', paymentMethod: 'SBP' }));
    expect(open).toHaveBeenCalledWith('https://pay.example.com/1', '_blank', 'noopener,noreferrer');
    expect(await screen.findByTestId('navigated')).toBeInTheDocument();
  });

  it('blocks checkout while SBP is unavailable', async () => {
    vi.spyOn(api, 'app').mockResolvedValue(SBER);
    vi.spyOn(api, 'paymentMethods').mockResolvedValue([]);

    renderWithProviders(<AppPage />, { route: '/apps/sberbank', path: '/apps/:appId' });

    expect(await screen.findByText(/Оплата временно недоступна/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Оплатить/ })).toBeDisabled();
  });

  it('shows checkout errors', async () => {
    vi.spyOn(api, 'app').mockResolvedValue(SBER);
    vi.spyOn(api, 'paymentMethods').mockResolvedValue([{ method: 'SBP' }]);
    vi.spyOn(api, 'createOrder').mockRejectedValue(new ApiError('PAYMENT_PROVIDER_ERROR', 'Не удалось создать платёж', 502));

    renderWithProviders(<AppPage />, { route: '/apps/sberbank', path: '/apps/:appId' });

    await screen.findByText('СБП');
    await userEvent.click(screen.getByRole('button', { name: /Оплатить/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось создать платёж');
  });
});

describe('GuidePage', () => {
  it('explains the Apple ID activation from download to getting your own Apple ID back', () => {
    renderWithProviders(<GuidePage />);

    expect(screen.getByRole('heading', { name: 'Как активировать приложение' })).toBeInTheDocument();
    const steps = within(screen.getByRole('list', { name: 'Шаги активации' })).getAllByRole('listitem');
    expect(steps).toHaveLength(6);
    expect(steps[0]).toHaveTextContent('Скачайте приложение');
    expect(steps[5]).toHaveTextContent('Верните свой Apple ID');
    expect(screen.getAllByText('Медиаматериалы и покупки').length).toBeGreaterThan(0);
  });

  it('lists the safety rules and answers common problems', () => {
    renderWithProviders(<GuidePage />);

    const rules = screen.getByRole('region', { name: 'Важно до начала' });
    expect(within(rules).getByText(/никогда не входите с ними в iCloud/i)).toBeInTheDocument();
    expect(within(rules).getByText(/Сгружать неиспользуемые/)).toBeInTheDocument();
    expect(screen.getByText('Код не приходит или не подходит')).toBeInTheDocument();
    expect(screen.getByText('Я удалил приложение')).toBeInTheDocument();
  });

  it('never mentions certificate, profile or IPA installation', () => {
    renderWithProviders(<GuidePage />);
    // Scoped to <main>: the bottom navigation has an unrelated «Профиль» tab.
    expect(screen.getByRole('main').textContent).not.toMatch(/сертификат|профил|IPA|разработчик|VPN/i);
  });
});
