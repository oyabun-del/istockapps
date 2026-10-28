import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MAX_ORDER_ITEMS } from '@istock/shared';
import { ApiError, api } from '../lib/api';
import { cartStore } from '../lib/cart';
import { ME, SBER, makeApp, renderWithProviders } from '../test/render';
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

describe('CatalogPage cart', () => {
  const TBANK = makeApp('tbank', 'Т-Банк');
  const CANVA = makeApp('canva', 'Canva');

  it('adds apps to the cart and shows the discount the moment the third one is added', async () => {
    vi.spyOn(api, 'categories').mockResolvedValue(CATEGORIES);
    vi.spyOn(api, 'apps').mockResolvedValue([SBER, TBANK, CANVA]);
    const app = vi.spyOn(api, 'app');
    renderWithProviders(<CatalogPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Добавить СберБанк Онлайн в корзину' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Добавьте ещё 2 приложения для скидки 300 ₽');
    expect(screen.getByRole('link', { name: /Корзина: 1 приложение/ })).toHaveTextContent('349 ₽');

    await userEvent.click(screen.getByRole('button', { name: 'Добавить Т-Банк в корзину' }));
    await userEvent.click(screen.getByRole('button', { name: 'Добавить Canva в корзину' }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Добавьте ещё 2 приложения для скидки 750 ₽'),
    );
    const bar = screen.getByRole('link', { name: 'Корзина: 3 приложения, скидка 300 ₽' });
    expect(within(bar).getByText('747 ₽')).toBeInTheDocument();
    expect(within(bar).getByText('447 ₽')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Убрать Canva из корзины' })).toHaveAttribute('aria-pressed', 'true');
    // Prices come from the catalog list already on screen.
    expect(app).not.toHaveBeenCalled();
  });

  it('removes an app from the cart with the same button', async () => {
    vi.spyOn(api, 'categories').mockResolvedValue(CATEGORIES);
    vi.spyOn(api, 'apps').mockResolvedValue([SBER]);
    renderWithProviders(<CatalogPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Добавить СберБанк Онлайн в корзину' }));
    await userEvent.click(screen.getByRole('button', { name: 'Убрать СберБанк Онлайн из корзины' }));

    expect(cartStore.getSnapshot()).toEqual([]);
    await waitFor(() => expect(screen.queryByRole('link', { name: /Корзина/ })).not.toBeInTheDocument());
  });
});

describe('AppPage', () => {
  it('only offers to add the app to the cart, then to open the cart', async () => {
    vi.spyOn(api, 'app').mockResolvedValue(SBER);
    const createOrder = vi.spyOn(api, 'createOrder');

    renderWithProviders(<AppPage />, { route: '/apps/sberbank', path: '/apps/:appId' });

    expect(await screen.findByText('Добавьте 3 приложения для скидки 300 ₽')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Оплатить/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'В корзину за 349 ₽' }));

    expect(cartStore.getSnapshot()).toEqual(['sberbank']);
    expect(await screen.findByRole('status')).toHaveTextContent('Добавьте ещё 2 приложения для скидки 300 ₽');
    await userEvent.click(screen.getByRole('button', { name: 'Перейти в корзину' }));
    expect(await screen.findByTestId('navigated')).toBeInTheDocument();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('takes the app back out of the cart', async () => {
    vi.spyOn(api, 'app').mockResolvedValue(SBER);
    cartStore.add('sberbank');

    renderWithProviders(<AppPage />, { route: '/apps/sberbank', path: '/apps/:appId' });

    await userEvent.click(await screen.findByRole('button', { name: 'Убрать из корзины' }));
    expect(cartStore.getSnapshot()).toEqual([]);
    expect(screen.getByRole('button', { name: 'В корзину за 349 ₽' })).toBeInTheDocument();
  });

  it('blocks adding when the cart is full', async () => {
    vi.spyOn(api, 'app').mockImplementation(async (id) => (id === SBER.id ? SBER : makeApp(id, id)));
    cartStore.addMany(Array.from({ length: MAX_ORDER_ITEMS }, (_, index) => `app-${index}`));

    renderWithProviders(<AppPage />, { route: '/apps/sberbank', path: '/apps/:appId' });

    expect(await screen.findByRole('button', { name: /В корзину/ })).toBeDisabled();
    expect(screen.getByText(`В одном заказе не больше ${MAX_ORDER_ITEMS} приложений`)).toBeInTheDocument();
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
