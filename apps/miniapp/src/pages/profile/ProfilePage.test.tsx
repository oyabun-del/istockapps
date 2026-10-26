import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import { queryKeys } from '../../lib/queries';
import { ME, makeOrder, renderWithProviders } from '../../test/render';
import { ProfilePage } from './ProfilePage';

function renderProfile(me = ME) {
  const result = renderWithProviders(<ProfilePage />);
  result.client.setQueryData(queryKeys.me, me);
  return result;
}

describe('ProfilePage', () => {
  it('shows who is signed in and real purchase counts', async () => {
    vi.spyOn(api, 'orders').mockResolvedValue([
      makeOrder({ id: 1, status: 'completed' }),
      makeOrder({ id: 2, status: 'paid' }),
      makeOrder({ id: 3, status: 'failed' }),
    ]);

    renderProfile();

    expect(await screen.findByRole('heading', { name: 'Иван' })).toBeInTheDocument();
    expect(screen.getByText('@ivan')).toBeInTheDocument();
    expect(screen.getByText('ID 42')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('stat-purchased')).toHaveTextContent('2'));
    expect(screen.getByTestId('stat-activated')).toHaveTextContent('1');
  });

  it('shows the app version at the bottom', async () => {
    vi.spyOn(api, 'orders').mockResolvedValue([]);

    renderProfile();

    expect(await screen.findByText(`AppDrop v${__APP_VERSION__}`)).toBeInTheDocument();
  });

  it('opens support and the channel inside Telegram', async () => {
    vi.spyOn(api, 'orders').mockResolvedValue([]);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    renderProfile();
    await userEvent.click(await screen.findByRole('button', { name: /Служба поддержки/ }));
    await userEvent.click(screen.getByRole('button', { name: /Наш канал/ }));

    expect(open).toHaveBeenNthCalledWith(1, 'https://t.me/support', '_blank', 'noopener,noreferrer');
    expect(open).toHaveBeenNthCalledWith(2, 'https://t.me/test_channel', '_blank', 'noopener,noreferrer');
    expect(screen.getByRole('link', { name: /Частые вопросы/ })).toHaveAttribute('href', '/guide');
    expect(screen.getByRole('link', { name: /Создать обращение/ })).toHaveAttribute('href', '/support');
  });

  it('shows the terms of service only when the shop published them', async () => {
    vi.spyOn(api, 'orders').mockResolvedValue([]);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    const { unmount } = renderProfile();
    expect(await screen.findByRole('button', { name: /Служба поддержки/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Пользовательское соглашение/ })).not.toBeInTheDocument();
    unmount();

    renderProfile({ ...ME, termsUrl: 'https://telegra.ph/terms' });
    await userEvent.click(await screen.findByRole('button', { name: /Пользовательское соглашение/ }));
    expect(open).toHaveBeenCalledWith('https://telegra.ph/terms', '_blank', 'noopener,noreferrer');
  });

  it('never shows certificate, device profile or warranty claims', async () => {
    vi.spyOn(api, 'orders').mockResolvedValue([]);
    const { container } = renderProfile();

    await screen.findByRole('button', { name: /Служба поддержки/ });
    expect(container.textContent).not.toMatch(/сертификат|UDID|профиль подписан|гаранти|IPA/i);
  });
});
