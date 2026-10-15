import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../../lib/api';
import { makeOrder, renderWithProviders } from '../../test/render';
import { OrderPage } from './OrderPage';

function renderOrder() {
  return renderWithProviders(<OrderPage />, { route: '/orders/7', path: '/orders/:orderId' });
}

describe('OrderPage', () => {
  it('asks to finish payment while unpaid', async () => {
    vi.spyOn(api, 'order').mockResolvedValue(makeOrder({ status: 'awaiting_payment', paymentUrl: 'https://pay.example.com/7' }));
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    renderOrder();

    expect(await screen.findByText('Ждём оплату')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Перейти к оплате/ }));
    expect(open).toHaveBeenCalledWith('https://pay.example.com/7', '_blank', 'noopener,noreferrer');
  });

  it('downloads and confirms the download', async () => {
    vi.spyOn(api, 'order').mockResolvedValue(makeOrder({ status: 'paid' }));
    vi.spyOn(api, 'download').mockResolvedValue({ url: 'https://cdn.example.com/app' });
    const confirm = vi.spyOn(api, 'confirmDownload').mockResolvedValue(makeOrder({ status: 'download_confirmed' }));
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    renderOrder();

    await userEvent.click(await screen.findByRole('button', { name: 'Скачать' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://cdn.example.com/app', '_blank', 'noopener,noreferrer'));
    await userEvent.click(screen.getByRole('button', { name: /Я скачал/ }));

    await waitFor(() => expect(confirm).toHaveBeenCalledWith(7));
    expect(await screen.findByRole('button', { name: /Получить логин и пароль/ })).toBeInTheDocument();
  });

  it('reveals credentials after download confirmation', async () => {
    vi.spyOn(api, 'order').mockResolvedValue(makeOrder({ status: 'download_confirmed' }));
    const credentials = vi.spyOn(api, 'credentials').mockResolvedValue({ login: 'id@example.com', password: 'secret' });

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
    const credentials = vi
      .spyOn(api, 'credentials')
      .mockRejectedValueOnce(new ApiError('DELIVERY_PROVIDER_ERROR', 'Сервис выдачи временно недоступен', 502))
      .mockResolvedValueOnce({ login: 'id@example.com', password: 'secret' });

    renderOrder();
    await userEvent.click(await screen.findByRole('button', { name: /Получить логин и пароль/ }));
    expect(await screen.findByText('Сервис выдачи временно недоступен')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Получить логин и пароль/ }));

    expect(await screen.findByText('id@example.com')).toBeInTheDocument();
    expect(credentials).toHaveBeenCalledTimes(2);
  });

  it('requests a login code and completes the order', async () => {
    vi.spyOn(api, 'order').mockResolvedValue(makeOrder({ status: 'credentials_issued' }));
    vi.spyOn(api, 'credentials').mockResolvedValue({ login: 'id@example.com', password: 'secret' });
    vi.spyOn(api, 'code').mockResolvedValue({ code: '482913', nextRequestAt: new Date(Date.now() + 30_000).toISOString() });
    const complete = vi.spyOn(api, 'complete').mockResolvedValue(makeOrder({ status: 'completed' }));

    renderOrder();

    expect(await screen.findByText('id@example.com')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Получить код/ }));
    expect(await screen.findByText('482913')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Новый код через/ })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: /Приложение работает/ }));
    await waitFor(() => expect(complete).toHaveBeenCalledWith(7));
    expect(await screen.findByText('Приложение активировано')).toBeInTheDocument();
  });

  it('shows code request errors', async () => {
    vi.spyOn(api, 'order').mockResolvedValue(makeOrder({ status: 'credentials_issued' }));
    vi.spyOn(api, 'credentials').mockResolvedValue({ login: 'a', password: 'b' });
    vi.spyOn(api, 'code').mockRejectedValue(new ApiError('TOO_MANY_REQUESTS', 'Подождите немного', 429));

    renderOrder();
    await userEvent.click(await screen.findByRole('button', { name: /Получить код/ }));
    expect(await screen.findByText('Подождите немного')).toBeInTheDocument();
  });

  it('offers to reorder after a failed payment', async () => {
    vi.spyOn(api, 'order').mockResolvedValue(makeOrder({ status: 'expired' }));
    renderOrder();
    expect(await screen.findByText('Оплата не завершена')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Оформить заново/ })).toHaveAttribute('href', '/apps/sberbank');
  });

  it('explains refunds and missing orders', async () => {
    vi.spyOn(api, 'order').mockResolvedValueOnce(makeOrder({ status: 'refunded' }));
    renderOrder();
    expect(await screen.findByText('Деньги возвращены')).toBeInTheDocument();
  });

  it('shows not found errors', async () => {
    vi.spyOn(api, 'order').mockRejectedValue(new ApiError('NOT_FOUND', 'Заказ не найден', 404));
    renderOrder();
    expect(await screen.findByText('Заказ не найден')).toBeInTheDocument();
  });
});
