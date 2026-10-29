import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ME, renderWithProviders } from '../../test/render';
import { SubscriptionGate } from './SubscriptionGate';

const GUEST = { ...ME, isSubscribed: false };

describe('SubscriptionGate', () => {
  it('shows the real channel name and audience', () => {
    renderWithProviders(<SubscriptionGate me={GUEST} />);

    expect(screen.getByRole('heading', { name: 'Подпишитесь на канал' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /iStockApps/ })).toHaveTextContent(/42,8\sтыс\. подписчиков/);
  });

  it('falls back gracefully when the bot cannot read the channel', () => {
    renderWithProviders(<SubscriptionGate me={{ ...GUEST, channel: { title: null, subscriberCount: null } }} />);

    expect(screen.getByRole('button', { name: /Наш канал/ })).not.toHaveTextContent(/подписчик/);
  });

  it('lets a guest read the terms and the privacy policy', () => {
    renderWithProviders(<SubscriptionGate me={GUEST} />);

    expect(screen.getByRole('link', { name: 'Пользовательское соглашение' })).toHaveAttribute('href', '/legal/terms');
    expect(screen.getByRole('link', { name: 'Политика конфиденциальности' })).toHaveAttribute('href', '/legal/privacy');
  });

  it('opens the channel and support inside Telegram', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderWithProviders(<SubscriptionGate me={GUEST} />);

    await userEvent.click(screen.getByRole('button', { name: 'Подписаться' }));
    await userEvent.click(screen.getByRole('button', { name: /Нужна помощь/ }));

    expect(open).toHaveBeenNthCalledWith(1, 'https://t.me/test_channel', '_blank', 'noopener,noreferrer');
    expect(open).toHaveBeenNthCalledWith(2, 'https://t.me/support', '_blank', 'noopener,noreferrer');
  });

  it('does not promise certificates or DNS', () => {
    const { container } = renderWithProviders(<SubscriptionGate me={GUEST} />);
    expect(container.textContent).not.toMatch(/сертификат|DNS|прямой доступ/i);
  });
});
