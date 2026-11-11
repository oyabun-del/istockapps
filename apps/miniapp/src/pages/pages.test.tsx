import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MAX_ORDER_ITEMS } from '@istock/shared';
import { ApiError, api } from '../lib/api';
import { cartStore } from '../lib/cart';
import { ACTIVATION_STEPS, CRITICAL_SAFETY_RULE } from '../content/guide';
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
    expect(screen.getByRole('link', { name: /Корзина: 1\u00a0приложение/ })).toHaveTextContent('349 ₽');

    await userEvent.click(screen.getByRole('button', { name: 'Добавить Т-Банк в корзину' }));
    await userEvent.click(screen.getByRole('button', { name: 'Добавить Canva в корзину' }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Добавьте ещё 2 приложения для скидки 750 ₽'),
    );
    const bar = screen.getByRole('link', { name: 'Корзина: 3\u00a0приложения, скидка 300\u00a0₽' });
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
    await userEvent.click(screen.getByRole('button', { name: 'В корзину за 349\u00a0₽' }));

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
    expect(screen.getByRole('button', { name: 'В корзину за 349\u00a0₽' })).toBeInTheDocument();
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
  const nth = (items: HTMLElement[], index: number): HTMLElement => {
    const item = items[index];
    if (!item) throw new Error(`No list item at ${index}`);
    return item;
  };

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
    expect(within(rules).getByText(/никогда не входите с данными из заказа в iCloud/i)).toBeInTheDocument();
    expect(within(rules).getByText(/Сгружать неиспользуемые/)).toBeInTheDocument();
    expect(within(rules).getByText(/Не удаляйте приложение/)).toBeInTheDocument();
    expect(screen.getByText('Код не приходит или не подходит')).toBeInTheDocument();
    expect(screen.getByText('Я удалил приложение')).toBeInTheDocument();
    expect(screen.getByText('Можно ли скачать приложение ещё раз после активации?')).toBeInTheDocument();
  });

  it('opens every step with its key action and shows the names to tap as chips', () => {
    renderWithProviders(<GuidePage />);
    const steps = within(screen.getByRole('list', { name: 'Шаги активации' })).getAllByRole('listitem');

    ACTIVATION_STEPS.forEach((step, index) => {
      expect(steps[index]).toHaveTextContent(step.action);
    });
    expect(within(nth(steps, 0)).getByText('Я скачал', { selector: 'strong' })).toBeInTheDocument();
    expect(within(nth(steps, 2)).getByText('Получить логин и пароль', { selector: 'strong' })).toBeInTheDocument();
    expect(within(nth(steps, 3)).getByText('Включить ожидание кода', { selector: 'strong' })).toBeInTheDocument();
    expect(within(nth(steps, 4)).getByText('Приложение работает', { selector: 'strong' })).toBeInTheDocument();
  });

  it('shows a described screen schematic in every step', () => {
    renderWithProviders(<GuidePage />);
    const steps = within(screen.getByRole('list', { name: 'Шаги активации' })).getAllByRole('listitem');

    const sources = steps.map((step, index) => {
      const images = step.querySelectorAll('img');
      expect(images).toHaveLength(1);
      expect(images[0]?.getAttribute('alt')).toBe(ACTIVATION_STEPS[index]?.image.alt);
      expect(images[0]?.getAttribute('alt')).toMatch(/^Схема: .{20,}/);
      return images[0]?.getAttribute('src');
    });
    expect(new Set(sources).size).toBe(ACTIVATION_STEPS.length);
  });

  it('opens a schematic full screen and closes it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GuidePage />);
    const [first] = screen.getAllByRole('button', { name: 'Увеличить схему' });
    if (!first) throw new Error('No schematic');

    await user.click(first);
    const dialog = screen.getByRole('dialog', { name: ACTIVATION_STEPS[0]?.image.alt });
    await user.click(within(dialog).getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(first);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('puts the iCloud ban first among the rules and highlights only it', () => {
    renderWithProviders(<GuidePage />);
    const region = within(screen.getByRole('region', { name: 'Важно до начала' }));

    expect(CRITICAL_SAFETY_RULE).toMatch(/iCloud/);
    expect(within(nth(region.getAllByRole('listitem'), 0)).getByText(CRITICAL_SAFETY_RULE, { selector: 'strong' })).toBeInTheDocument();
    // A whole rule in bold is the highlight; chips inside the other rules are nested deeper.
    expect(region.getAllByText(/.+/, { selector: 'li > strong' })).toHaveLength(1);
  });

  it('matches the buttons of the order screen and never promises a free re-download', () => {
    renderWithProviders(<GuidePage />);
    const text = screen.getByRole('main').textContent ?? '';

    expect(text).toContain('«Включить ожидание кода»');
    expect(text).toContain('«Apple не запросил код»');
    expect(text).not.toMatch(/«Получить код»|«Запросить новый код»|«Скачать снова»|Платить повторно не нужно/);
  });

  it('never mentions certificate, profile or IPA installation', () => {
    renderWithProviders(<GuidePage />);
    // Scoped to <main>: the bottom navigation has an unrelated «Профиль» tab.
    expect(screen.getByRole('main').textContent).not.toMatch(/сертификат|профил|IPA|разработчик|VPN/i);
  });
});
