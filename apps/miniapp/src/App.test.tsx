import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { ApiError, api } from './lib/api';
import { ROUTER_FUTURE } from './lib/router';
import { ME, SBER } from './test/render';

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter future={ROUTER_FUTURE}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('App', () => {
  it('shows the subscription gate and lets the user in after subscribing', async () => {
    vi.spyOn(api, 'me').mockResolvedValue({ ...ME, isSubscribed: false });
    const check = vi
      .spyOn(api, 'checkSubscription')
      .mockResolvedValueOnce({ isSubscribed: false })
      .mockResolvedValueOnce({ isSubscribed: true });
    vi.spyOn(api, 'categories').mockResolvedValue([]);
    vi.spyOn(api, 'apps').mockResolvedValue([SBER]);

    renderApp();

    expect(await screen.findByText('Подпишитесь на канал')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Проверить подписку/ }));
    expect(await screen.findByText('Подписка не найдена')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Проверить подписку/ }));
    expect(await screen.findByText('СберБанк Онлайн')).toBeInTheDocument();
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('shows a retryable error when the profile cannot load', async () => {
    vi.spyOn(api, 'me').mockRejectedValue(new ApiError('UNAUTHORIZED', 'Откройте магазин через Telegram', 401));
    renderApp();
    expect(await screen.findByText('Откройте магазин через Telegram')).toBeInTheDocument();
  });

  it('opens the order from start_param', async () => {
    window.Telegram = {
      WebApp: {
        initData: 'x',
        initDataUnsafe: { start_param: '7' },
        BackButton: { show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() },
        HapticFeedback: { impactOccurred: vi.fn(), notificationOccurred: vi.fn() },
      } as never,
    };
    vi.spyOn(api, 'me').mockResolvedValue(ME);
    const order = vi.spyOn(api, 'order').mockRejectedValue(new ApiError('NOT_FOUND', 'Заказ не найден', 404));

    renderApp();

    expect(await screen.findByText('Заказ не найден')).toBeInTheDocument();
    expect(order).toHaveBeenCalledWith(7);
  });
});
