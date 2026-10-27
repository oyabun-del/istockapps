import type { CodeWaitDto, CredentialsDto, DeliveryAppDto, DeliveryDto, DeliveryGroupDto } from '@istock/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../../lib/api';
import { makeOrder, renderWithProviders } from '../../test/render';
import { OrderPage } from './OrderPage';

function renderOrder() {
  return renderWithProviders(<OrderPage />, { route: '/orders/7', path: '/orders/:orderId' });
}

const IN_15_MINUTES = () => new Date(Date.now() + 15 * 60 * 1000 - 500).toISOString();

function unpaidOrder() {
  return makeOrder({
    status: 'awaiting_payment',
    paymentUrl: 'https://pay.example.com/7',
    expiresAt: IN_15_MINUTES(),
    paidAt: null,
  });
}

describe('OrderPage while unpaid', () => {
  it('counts down the invoice and opens the payment page for the chosen method', async () => {
    vi.spyOn(api, 'order').mockResolvedValue(unpaidOrder());
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    renderOrder();

    expect(await screen.findByText('Ожидание оплаты')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent('15:00');
    expect(screen.getByText('Статус проверяется автоматически каждые 4 с')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Оплатить через СБП' }));
    expect(open).toHaveBeenCalledWith('https://pay.example.com/7', '_blank', 'noopener,noreferrer');
  });

  it('checks the payment status on demand', async () => {
    const order = vi.spyOn(api, 'order').mockResolvedValue(unpaidOrder());

    renderOrder();
    await userEvent.click(await screen.findByRole('button', { name: /Проверить статус платежа/ }));

    await waitFor(() => expect(order).toHaveBeenCalledTimes(2));
  });

  it('cancels only after an explicit confirmation', async () => {
    vi.spyOn(api, 'order').mockResolvedValue(unpaidOrder());
    const cancel = vi.spyOn(api, 'cancelOrder').mockResolvedValue(makeOrder({ status: 'cancelled', paidAt: null }));

    renderOrder();
    await userEvent.click(await screen.findByRole('button', { name: 'Отменить заказ' }));
    expect(cancel).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: 'Да, отменить' }));

    await waitFor(() => expect(cancel).toHaveBeenCalledWith(7));
    expect(await screen.findByRole('heading', { name: 'Заказ отменён' })).toBeInTheDocument();
  });
});

describe('OrderPage after the invoice closed', () => {
  it('explains an expired invoice and offers to order again', async () => {
    vi.spyOn(api, 'order').mockResolvedValue(makeOrder({ status: 'expired', paidAt: null }));

    renderOrder();

    expect(await screen.findByRole('heading', { name: 'Счёт истёк' })).toBeInTheDocument();
    expect(screen.getByText('Номер заказа')).toBeInTheDocument();
    expect(screen.getByText(/Если банк всё же списал деньги/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Оформить заново/ })).toHaveAttribute('href', '/apps/sberbank');
  });

  it('does not offer to reorder a refunded order', async () => {
    vi.spyOn(api, 'order').mockResolvedValue(makeOrder({ status: 'refunded' }));

    renderOrder();

    expect(await screen.findByRole('heading', { name: 'Деньги возвращены' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Оформить заново/ })).not.toBeInTheDocument();
  });
});


const IN_6_HOURS = () => new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();

function appEntry(id: string, state: DeliveryAppDto['state'] = 'available'): DeliveryAppDto {
  return {
    id,
    name: id.toUpperCase(),
    state,
    links: state === 'available' ? { main: `https://install.example/${id}`, reserve: `https://reserve.example/${id}` } : null,
  };
}

function deliveryGroup(id: string, apps: DeliveryAppDto[], overrides: Partial<DeliveryGroupDto> = {}): DeliveryGroupDto {
  return {
    id,
    state: apps[0]?.state ?? 'available',
    expiresAt: IN_6_HOURS(),
    message: null,
    codesLeft: 3,
    apps,
    ...overrides,
  };
}

function delivery(groups: DeliveryGroupDto[] = [deliveryGroup('grp_1', [appEntry('app_sber')])]): DeliveryDto {
  return { expiresAt: IN_6_HOURS(), isSandbox: false, groups, isReplacing: groups.some((g) => g.state === 'replacing') };
}

function credentialsFor(groupId = 'grp_1', login = 'id@example.com', password = 'secret'): CredentialsDto {
  return { groups: [{ groupId, login, password }] };
}

function codeWait(overrides: Partial<CodeWaitDto> = {}): CodeWaitDto {
  return {
    id: 'wait_1',
    groupId: 'grp_1',
    status: 'active',
    code: null,
    codeExpiresAt: null,
    deadlineAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function issuedOrder() {
  vi.spyOn(api, 'order').mockResolvedValue(makeOrder({ status: 'credentials_issued' }));
  vi.spyOn(api, 'delivery').mockResolvedValue(delivery());
  vi.spyOn(api, 'credentials').mockResolvedValue(credentialsFor());
}

describe('OrderPage steps', () => {
  const TITLES = ['Скачайте приложение', 'Войдите в App Store', 'Введите код подтверждения', 'Откройте приложение'];

  function visibleTitles() {
    return TITLES.filter((title) => screen.queryByRole('heading', { name: title }));
  }

  it.each([
    { order: makeOrder({ status: 'paid' }), shown: 1, label: 'Шаг 1 из 4' },
    { order: makeOrder({ status: 'download_confirmed' }), shown: 2, label: 'Шаг 2 из 4' },
    { order: makeOrder({ status: 'credentials_issued' }), shown: 3, label: 'Шаг 3 из 4' },
    { order: makeOrder({ status: 'credentials_issued', isCodeReceived: true }), shown: 4, label: 'Шаг 4 из 4' },
  ])('shows only the steps opened so far ($label)', async ({ order, shown, label }) => {
    vi.spyOn(api, 'order').mockResolvedValue(order);
    vi.spyOn(api, 'delivery').mockResolvedValue(delivery());
    vi.spyOn(api, 'credentials').mockResolvedValue(credentialsFor());

    renderOrder();

    expect(await screen.findByText(label)).toBeInTheDocument();
    expect(visibleTitles()).toEqual(TITLES.slice(0, shown));
  });

  it('marks a completed order as done', async () => {
    vi.spyOn(api, 'order').mockResolvedValue(makeOrder({ status: 'completed', isCodeReceived: true }));
    vi.spyOn(api, 'delivery').mockResolvedValue(delivery());
    vi.spyOn(api, 'credentials').mockResolvedValue(credentialsFor());

    renderOrder();

    expect(await screen.findByText('Готово')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Приложение активировано' })).toBeInTheDocument();
  });

  it('opens the last step when Apple did not ask for a code', async () => {
    issuedOrder();
    const skip = vi
      .spyOn(api, 'skipCode')
      .mockResolvedValue(makeOrder({ status: 'credentials_issued', isCodeReceived: true }));

    renderOrder();
    await userEvent.click(await screen.findByRole('button', { name: /Apple не запросил код/ }));

    await waitFor(() => expect(skip).toHaveBeenCalledWith(7));
    expect(await screen.findByRole('button', { name: /Приложение работает/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Apple не запросил код/ })).not.toBeInTheDocument();
  });
});

describe('OrderPage delivery', () => {
  it('opens the main and reserve links and confirms the download', async () => {
    vi.spyOn(api, 'order').mockResolvedValue(makeOrder({ status: 'paid' }));
    vi.spyOn(api, 'delivery').mockResolvedValue(delivery());
    const confirm = vi.spyOn(api, 'confirmDownload').mockResolvedValue(makeOrder({ status: 'download_confirmed' }));
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    renderOrder();

    await userEvent.click(await screen.findByRole('button', { name: 'Скачать' }));
    expect(open).toHaveBeenCalledWith('https://install.example/app_sber', '_blank', 'noopener,noreferrer');
    await userEvent.click(screen.getByRole('button', { name: /Резервная ссылка/ }));
    expect(open).toHaveBeenCalledWith('https://reserve.example/app_sber', '_blank', 'noopener,noreferrer');
    expect(screen.getByText(/Ссылки действуют до/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Я скачал/ }));

    await waitFor(() => expect(confirm).toHaveBeenCalledWith(7));
    expect(await screen.findByRole('button', { name: /Получить логин и пароль/ })).toBeInTheDocument();
  });

  it('keeps the working app available while another one waits for a replacement', async () => {
    vi.spyOn(api, 'order').mockResolvedValue(makeOrder({ status: 'paid' }));
    vi.spyOn(api, 'delivery').mockResolvedValue(
      delivery([
        deliveryGroup('grp_blocked', [appEntry('app_a', 'replacing')]),
        deliveryGroup('grp_ok', [appEntry('app_b')]),
      ]),
    );

    renderOrder();

    expect(await screen.findByText(/Подбираем замену бесплатно/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Скачать' })).toHaveLength(1);
    expect(screen.getByText('APP_B')).toBeInTheDocument();
  });

  it('shows the revocation message without any link', async () => {
    vi.spyOn(api, 'order').mockResolvedValue(makeOrder({ status: 'paid' }));
    vi.spyOn(api, 'delivery').mockResolvedValue(
      delivery([deliveryGroup('grp_1', [appEntry('app_a', 'revoked')], { message: 'Учётка заблокирована' })]),
    );

    renderOrder();

    expect(await screen.findByText('Учётка заблокирована')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Скачать' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Я скачал/ })).not.toBeInTheDocument();
  });

  it('marks the sandbox mode', async () => {
    vi.spyOn(api, 'order').mockResolvedValue(makeOrder({ status: 'paid' }));
    vi.spyOn(api, 'delivery').mockResolvedValue({ ...delivery(), isSandbox: true });

    renderOrder();

    expect(await screen.findByText(/Тестовый режим/)).toBeInTheDocument();
  });

  it('shows delivery errors with a retry', async () => {
    vi.spyOn(api, 'order').mockResolvedValue(makeOrder({ status: 'paid' }));
    const load = vi
      .spyOn(api, 'delivery')
      .mockRejectedValueOnce(new ApiError('TOO_MANY_REQUESTS', 'Слишком много запросов', 429))
      .mockResolvedValue(delivery());

    renderOrder();
    expect(await screen.findByText('Слишком много запросов')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Повторить/ }));

    expect(await screen.findByRole('button', { name: 'Скачать' })).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('OrderPage credentials', () => {
  it('reveals credentials after download confirmation', async () => {
    vi.spyOn(api, 'order').mockResolvedValue(makeOrder({ status: 'download_confirmed' }));
    vi.spyOn(api, 'delivery').mockResolvedValue(delivery());
    const credentials = vi.spyOn(api, 'credentials').mockResolvedValue(credentialsFor());

    renderOrder();
    await userEvent.click(await screen.findByRole('button', { name: /Получить логин и пароль/ }));

    expect(await screen.findByText('id@example.com')).toBeInTheDocument();
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Показать' }));
    expect(screen.getByText('secret')).toBeInTheDocument();
    expect(credentials).toHaveBeenCalledWith(7);
  });

  it('retries the credentials request after a delivery error', async () => {
    vi.spyOn(api, 'order').mockResolvedValue(makeOrder({ status: 'download_confirmed' }));
    vi.spyOn(api, 'delivery').mockResolvedValue(delivery());
    const credentials = vi
      .spyOn(api, 'credentials')
      .mockRejectedValueOnce(new ApiError('DELIVERY_PROVIDER_ERROR', 'Сервис выдачи временно недоступен', 502))
      .mockResolvedValueOnce(credentialsFor());

    renderOrder();
    await userEvent.click(await screen.findByRole('button', { name: /Получить логин и пароль/ }));
    expect(await screen.findByText('Сервис выдачи временно недоступен')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Получить логин и пароль/ }));

    expect(await screen.findByText('id@example.com')).toBeInTheDocument();
    expect(credentials).toHaveBeenCalledTimes(2);
  });

  it('does not ask for credentials while no account is available', async () => {
    vi.spyOn(api, 'order').mockResolvedValue(makeOrder({ status: 'credentials_issued' }));
    vi.spyOn(api, 'delivery').mockResolvedValue(delivery([deliveryGroup('grp_1', [appEntry('app_a', 'replacing')])]));
    const credentials = vi.spyOn(api, 'credentials');

    renderOrder();

    expect(await screen.findByText(/Код станет доступен/)).toBeInTheDocument();
    expect(credentials).not.toHaveBeenCalled();
  });
});

describe('OrderPage login code', () => {
  it('turns on the wait, shows the fresh code, then opens the last step and completes the order', async () => {
    issuedOrder();
    // The server marks the code step done once it has seen the code.
    let isCodeReceived = false;
    vi.mocked(api.order).mockImplementation(async () => makeOrder({ status: 'credentials_issued', isCodeReceived }));
    const start = vi.spyOn(api, 'startCode').mockResolvedValue(codeWait());
    vi.spyOn(api, 'codeWait')
      .mockResolvedValueOnce(codeWait())
      .mockImplementation(async () => {
        isCodeReceived = true;
        return codeWait({ status: 'succeeded', code: '482913', codeExpiresAt: new Date(Date.now() + 60_000).toISOString() });
      });
    const complete = vi.spyOn(api, 'complete').mockResolvedValue(makeOrder({ status: 'completed', isCodeReceived: true }));

    renderOrder();
    expect(await screen.findByText('id@example.com')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Приложение работает/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Включить ожидание кода/ }));

    expect(start).toHaveBeenCalledWith(7, 'grp_1');
    expect(await screen.findByText(/Ждём код/)).toBeInTheDocument();
    expect(await screen.findByText('482913', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText(/Действует ещё/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Включить ожидание кода/ })).not.toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: /Приложение работает/ }));
    await waitFor(() => expect(complete).toHaveBeenCalledWith(7));
    expect(await screen.findByText('Приложение активировано')).toBeInTheDocument();
  });

  it('removes an expired code and offers a new attempt', async () => {
    issuedOrder();
    vi.spyOn(api, 'startCode').mockResolvedValue(
      codeWait({ status: 'succeeded', code: '111222', codeExpiresAt: new Date(Date.now() - 1000).toISOString() }),
    );

    renderOrder();
    await userEvent.click(await screen.findByRole('button', { name: /Включить ожидание кода/ }));

    expect(await screen.findByText(/Код истёк/)).toBeInTheDocument();
    expect(screen.queryByText('111222')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Включить ожидание кода/ })).toBeEnabled();
  });

  it('stops after a timeout and lets the buyer try again', async () => {
    issuedOrder();
    vi.spyOn(api, 'startCode').mockResolvedValue(codeWait({ status: 'timed_out' }));

    renderOrder();
    await userEvent.click(await screen.findByRole('button', { name: /Включить ожидание кода/ }));

    expect(await screen.findByText(/не пришёл за 5 минут/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Включить ожидание кода/ })).toBeInTheDocument();
  });

  it('re-reads the delivery when the wait is cancelled', async () => {
    issuedOrder();
    vi.spyOn(api, 'startCode').mockResolvedValue(codeWait({ status: 'cancelled' }));

    renderOrder();
    await userEvent.click(await screen.findByRole('button', { name: /Включить ожидание кода/ }));

    expect(await screen.findByText(/доступ к аккаунту изменился/)).toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(api.delivery).mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('blocks the button when the code limit is used up', async () => {
    vi.spyOn(api, 'order').mockResolvedValue(makeOrder({ status: 'credentials_issued' }));
    vi.spyOn(api, 'delivery').mockResolvedValue(delivery([deliveryGroup('grp_1', [appEntry('app_a')], { codesLeft: 0 })]));
    vi.spyOn(api, 'credentials').mockResolvedValue(credentialsFor());

    renderOrder();

    expect(await screen.findByRole('button', { name: /Лимит кодов исчерпан/ })).toBeDisabled();
  });

  it('shows code request errors', async () => {
    issuedOrder();
    vi.spyOn(api, 'startCode').mockRejectedValue(new ApiError('INVALID_STATE', 'Доступ к этому аккаунту отозван', 409));

    renderOrder();
    await userEvent.click(await screen.findByRole('button', { name: /Включить ожидание кода/ }));

    expect(await screen.findByText('Доступ к этому аккаунту отозван')).toBeInTheDocument();
  });

  it('shows not found errors', async () => {
    vi.spyOn(api, 'order').mockRejectedValue(new ApiError('NOT_FOUND', 'Заказ не найден', 404));
    renderOrder();
    expect(await screen.findByText('Заказ не найден')).toBeInTheDocument();
  });
});
