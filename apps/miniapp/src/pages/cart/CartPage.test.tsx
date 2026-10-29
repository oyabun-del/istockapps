import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../../lib/api';
import { cartStore } from '../../lib/cart';
import { SBER, makeApp, makeOrder, renderWithProviders } from '../../test/render';
import { CartPage } from './CartPage';

const CATALOG = [SBER, makeApp('tbank', 'Т-Банк'), makeApp('canva', 'Canva'), makeApp('minecraft', 'Minecraft', 29900), makeApp('vtb', 'ВТБ')];

function mockCatalog() {
  return vi.spyOn(api, 'app').mockImplementation(async (id) => {
    const app = CATALOG.find((item) => item.id === id);
    if (!app) throw new ApiError('NOT_FOUND', 'Приложение не найдено', 404);
    return app;
  });
}

function fillCart(count: number) {
  cartStore.addMany(CATALOG.slice(0, count).map((app) => app.id));
}

function renderCart() {
  return renderWithProviders(<CartPage />, { route: '/cart', path: '/cart' });
}

describe('CartPage', () => {
  it('invites to the catalog when the cart is empty', () => {
    renderCart();

    expect(screen.getByRole('heading', { name: 'Корзина пуста' })).toBeInTheDocument();
    expect(screen.getByText(/от 3 приложений — скидка 100 ₽ на каждое, от 5 приложений — скидка 250 ₽/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Перейти в каталог' })).toHaveAttribute('href', '/');
  });

  it('shows prices without a discount and tells how many apps are left', async () => {
    mockCatalog();
    vi.spyOn(api, 'paymentMethods').mockResolvedValue([{ method: 'SBP' }]);
    fillCart(2);

    renderCart();

    expect(await screen.findByText('Добавьте ещё 1 приложение для скидки 300 ₽')).toBeInTheDocument();
    const summary = screen.getByLabelText('Итог');
    expect(within(summary).queryByText('Скидка')).not.toBeInTheDocument();
    expect(within(summary).getByText('548 ₽')).toBeInTheDocument();
  });

  it('applies 100 ₽ per app from three apps', async () => {
    mockCatalog();
    vi.spyOn(api, 'paymentMethods').mockResolvedValue([{ method: 'SBP' }]);
    fillCart(3);

    renderCart();

    const summary = await screen.findByLabelText('Итог');
    expect(within(summary).getByText('747 ₽')).toBeInTheDocument();
    expect(within(summary).getByText('−300 ₽')).toBeInTheDocument();
    expect(within(summary).getByText('447 ₽')).toBeInTheDocument();
    expect(screen.getByText('Добавьте ещё 2 приложения для скидки 1 250 ₽')).toBeInTheDocument();
  });

  it('applies 250 ₽ per app from five apps, down to 1 ₽ for cheap ones', async () => {
    mockCatalog();
    vi.spyOn(api, 'paymentMethods').mockResolvedValue([{ method: 'SBP' }]);
    fillCart(5);

    renderCart();

    const summary = await screen.findByLabelText('Итог');
    expect(within(summary).getByText('−1 094 ₽')).toBeInTheDocument();
    expect(within(summary).getByText('151 ₽')).toBeInTheDocument();
    expect(screen.getByText('Максимальная скидка применена')).toBeInTheDocument();
  });

  it('recalculates the discount when an app is removed', async () => {
    mockCatalog();
    vi.spyOn(api, 'paymentMethods').mockResolvedValue([{ method: 'SBP' }]);
    fillCart(3);
    renderCart();

    await userEvent.click(await screen.findByRole('button', { name: 'Убрать Canva из корзины' }));

    const summary = screen.getByLabelText('Итог');
    await waitFor(() => expect(within(summary).queryByText('Скидка')).not.toBeInTheDocument());
    expect(within(summary).getByText('548 ₽')).toBeInTheDocument();
  });

  it('pays for the whole cart in one order and empties the cart', async () => {
    mockCatalog();
    vi.spyOn(api, 'paymentMethods').mockResolvedValue([{ method: 'SBP' }]);
    const createOrder = vi
      .spyOn(api, 'createOrder')
      .mockResolvedValue(makeOrder({ status: 'awaiting_payment', paymentUrl: 'https://pay.example.com/1' }));
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    fillCart(3);
    renderCart();

    await screen.findByText('СБП');
    await userEvent.click(screen.getByRole('button', { name: 'Оплатить 447\u00a0₽' }));

    await waitFor(() =>
      expect(createOrder).toHaveBeenCalledWith({
        appIds: ['sberbank', 'tbank', 'canva'],
        paymentMethod: 'SBP',
        expectedTotalKopecks: 44700,
      }),
    );
    expect(open).toHaveBeenCalledWith('https://pay.example.com/1', '_blank', 'noopener,noreferrer');
    expect(await screen.findByTestId('navigated')).toBeInTheDocument();
    expect(cartStore.getSnapshot()).toEqual([]);
  });

  it('keeps the cart and reloads prices when they changed', async () => {
    const app = mockCatalog();
    vi.spyOn(api, 'paymentMethods').mockResolvedValue([{ method: 'SBP' }]);
    vi.spyOn(api, 'createOrder').mockRejectedValue(new ApiError('PRICE_CHANGED', 'Цены обновились', 409));
    fillCart(3);
    renderCart();

    await screen.findByText('СБП');
    const loads = app.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: /Оплатить/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Цены обновились');
    await waitFor(() => expect(app.mock.calls.length).toBeGreaterThan(loads));
    expect(cartStore.getSnapshot()).toHaveLength(3);
  });

  it('names the new total once the changed prices are loaded', async () => {
    const app = mockCatalog();
    vi.spyOn(api, 'paymentMethods').mockResolvedValue([{ method: 'SBP' }]);
    vi.spyOn(api, 'createOrder').mockRejectedValue(new ApiError('PRICE_CHANGED', 'Цены обновились', 409));
    fillCart(1);
    renderCart();

    await screen.findByRole('button', { name: 'Оплатить 349\u00a0₽' });
    app.mockResolvedValue({ ...SBER, priceKopecks: 39900 });
    await userEvent.click(screen.getByRole('button', { name: /Оплатить/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Цена изменилась: теперь 399 ₽. Проверьте и оплатите ещё раз.');
    expect(screen.getByRole('button', { name: 'Оплатить 399\u00a0₽' })).toBeInTheDocument();
  });

  it('clears a checkout error once the cart changes', async () => {
    mockCatalog();
    vi.spyOn(api, 'paymentMethods').mockResolvedValue([{ method: 'SBP' }]);
    vi.spyOn(api, 'createOrder').mockRejectedValue(new ApiError('PRICE_CHANGED', 'Цены обновились', 409));
    fillCart(2);
    renderCart();

    await screen.findByText('СБП');
    await userEvent.click(screen.getByRole('button', { name: /Оплатить/ }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: /Убрать/ })[0] as HTMLElement);

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('blocks payment while SBP is unavailable', async () => {
    mockCatalog();
    vi.spyOn(api, 'paymentMethods').mockResolvedValue([]);
    fillCart(1);

    renderCart();

    expect(await screen.findByText(/Оплата временно недоступна/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Оплатить/ })).toBeDisabled();
  });

  it('drops apps that are no longer sold', async () => {
    mockCatalog();
    vi.spyOn(api, 'paymentMethods').mockResolvedValue([{ method: 'SBP' }]);
    cartStore.addMany(['sberbank', 'gone']);

    renderCart();

    await waitFor(() => expect(cartStore.getSnapshot()).toEqual(['sberbank']));
    expect(await screen.findByRole('button', { name: 'Оплатить 349\u00a0₽' })).toBeInTheDocument();
    expect(screen.getByText('Некоторые приложения больше недоступны и убраны из корзины')).toHaveAttribute('role', 'status');
  });

  it('shows catalog errors with a retry', async () => {
    const app = vi.spyOn(api, 'app').mockRejectedValue(new ApiError('CATALOG_PROVIDER_ERROR', 'Каталог недоступен', 502));
    vi.spyOn(api, 'paymentMethods').mockResolvedValue([{ method: 'SBP' }]);
    fillCart(1);

    renderCart();

    expect(await screen.findByText('Каталог недоступен')).toBeInTheDocument();
    app.mockResolvedValue(SBER);
    await userEvent.click(screen.getByRole('button', { name: /Повторить/ }));
    expect(await screen.findByRole('button', { name: 'Оплатить 349\u00a0₽' })).toBeInTheDocument();
  });
});
