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

  it('tells that paying accepts the terms and the privacy policy', async () => {
    mockCatalog();
    vi.spyOn(api, 'paymentMethods').mockResolvedValue([{ method: 'SBP' }]);
    fillCart(1);

    renderCart();

    expect(await screen.findByText(/Нажимая «Оплатить», вы принимаете/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'условия соглашения' })).toHaveAttribute('href', '/legal/terms');
    expect(screen.getByRole('link', { name: 'политику конфиденциальности' })).toHaveAttribute('href', '/legal/privacy');
  });

  it('blocks payment while SBP is unavailable', async () => {
    mockCatalog();
    vi.spyOn(api, 'paymentMethods').mockResolvedValue([]);
    fillCart(1);

    renderCart();

    expect(await screen.findByText(/Оплата временно недоступна/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Оплатить/ })).toBeDisabled();
  });

  describe('order amount limit', () => {
    function renderPricedAt(priceKopecks: number) {
      vi.spyOn(api, 'app').mockResolvedValue(makeApp('big', 'Большое приложение', priceKopecks));
      vi.spyOn(api, 'paymentMethods').mockResolvedValue([{ method: 'SBP' }]);
      cartStore.addMany(['big']);
      renderCart();
    }

    it('blocks payment above the limit and explains what to do', async () => {
      renderPricedAt(1_000_001);

      expect(await screen.findByText(/Максимальная сумма заказа/)).toHaveAttribute('role', 'status');
      await screen.findByText('СБП');
      expect(screen.getByRole('button', { name: /Оплатить/ })).toBeDisabled();
    });

    it('lets an order of exactly the maximum amount through', async () => {
      renderPricedAt(1_000_000);

      await screen.findByText('СБП');
      await waitFor(() => expect(screen.getByRole('button', { name: /Оплатить/ })).toBeEnabled());
      expect(screen.queryByText(/Максимальная сумма заказа/)).not.toBeInTheDocument();
    });
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

describe('CartPage payments mode', () => {
  function mockShop(paymentsMode: 'open' | 'promo' | 'closed') {
    mockCatalog();
    vi.spyOn(api, 'paymentMethods').mockResolvedValue([{ method: 'SBP' }]);
    vi.spyOn(api, 'checkout').mockResolvedValue({ paymentsMode });
  }

  it('keeps the cart but refuses to pay while payments are closed', async () => {
    mockShop('closed');
    fillCart(1);

    renderCart();

    expect(await screen.findByText(/Приём оплат временно приостановлен/)).toHaveAttribute('role', 'status');
    expect(screen.getByRole('button', { name: /Оплатить/ })).toBeDisabled();
    expect(screen.queryByRole('textbox', { name: 'Промокод' })).not.toBeInTheDocument();
  });

  it('asks for a promo code and pays with it once it is applied', async () => {
    mockShop('promo');
    const checkPromo = vi.spyOn(api, 'checkPromo').mockResolvedValue({ code: 'IOS-REVIEW', appsLeft: 5 });
    const createOrder = vi
      .spyOn(api, 'createOrder')
      .mockResolvedValue(makeOrder({ status: 'awaiting_payment', paymentUrl: 'https://pay.example.com/1' }));
    vi.spyOn(window, 'open').mockReturnValue(null);
    fillCart(2);
    renderCart();

    const input = await screen.findByRole('textbox', { name: 'Промокод' });
    expect(screen.getByRole('button', { name: /Оплатить/ })).toBeDisabled();
    await userEvent.type(input, 'ios-review');
    await userEvent.click(screen.getByRole('button', { name: 'Применить' }));

    expect(checkPromo).toHaveBeenCalledWith('ios-review');
    expect(await screen.findByText('IOS-REVIEW')).toBeInTheDocument();
    expect(screen.getByText(/^Можно оплатить ещё 5\sприложений$/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Оплатить/ }));

    await waitFor(() =>
      expect(createOrder).toHaveBeenCalledWith(
        expect.objectContaining({ appIds: ['sberbank', 'tbank'], promoCode: 'IOS-REVIEW' }),
      ),
    );
  });

  it('shows why a promo code was not accepted', async () => {
    mockShop('promo');
    vi.spyOn(api, 'checkPromo').mockRejectedValue(
      new ApiError('PROMO_INVALID', 'Промокод не найден или больше не действует', 400),
    );
    fillCart(1);
    renderCart();

    await userEvent.type(await screen.findByRole('textbox', { name: 'Промокод' }), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Применить' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Промокод не найден или больше не действует');
    expect(screen.getByRole('button', { name: /Оплатить/ })).toBeDisabled();
  });

  it('warns when the cart has more apps than the code still covers, and the code can be removed', async () => {
    mockShop('promo');
    vi.spyOn(api, 'checkPromo').mockResolvedValue({ code: 'IOS-REVIEW', appsLeft: 1 });
    fillCart(2);
    renderCart();

    await userEvent.type(await screen.findByRole('textbox', { name: 'Промокод' }), 'IOS-REVIEW');
    await userEvent.click(screen.getByRole('button', { name: 'Применить' }));

    expect(await screen.findByText(/По промокоду можно оплатить ещё 1\sприложение/)).toHaveAttribute('role', 'status');
    // The server has the final word: this cart may be the buyer's own open invoice.
    expect(screen.getByRole('button', { name: /Оплатить/ })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Убрать промокод' }));
    expect(screen.getByRole('textbox', { name: 'Промокод' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Оплатить/ })).toBeDisabled();
  });

  it('does not send a promo code while payments are open to everyone', async () => {
    mockShop('open');
    const createOrder = vi.spyOn(api, 'createOrder').mockResolvedValue(makeOrder({ status: 'awaiting_payment' }));
    fillCart(1);
    renderCart();

    await screen.findByText('СБП');
    expect(screen.queryByRole('textbox', { name: 'Промокод' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Оплатить/ }));

    await waitFor(() => expect(createOrder).toHaveBeenCalled());
    expect(createOrder.mock.calls[0]?.[0]).not.toHaveProperty('promoCode');
  });
});
