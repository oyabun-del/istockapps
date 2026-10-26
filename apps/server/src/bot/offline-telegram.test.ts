import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../lib/logger.js';
import { silentLogger } from '../lib/logger.js';
import { createOfflineTelegram } from './offline-telegram.js';

describe('createOfflineTelegram', () => {
  it('treats every user as subscribed to the channel', async () => {
    const telegram = createOfflineTelegram({ channel: '@test_channel', logger: silentLogger });

    expect(await telegram.fetchMember('@test_channel', 42)).toEqual({ status: 'member' });
  });

  it('describes the channel without calling Telegram', async () => {
    const telegram = createOfflineTelegram({ channel: '@test_channel', logger: silentLogger });

    expect(await telegram.fetchChannel('@test_channel')).toEqual({ title: '@test_channel', memberCount: 0 });
  });

  it('writes notifications to the log instead of sending them', async () => {
    const info = vi.fn();
    const logger = { ...silentLogger, info } as unknown as Logger;
    const telegram = createOfflineTelegram({ channel: '@test_channel', logger });

    await telegram.sender.send(111, '<b>Новая покупка: AT&amp;T</b>', { text: 'Открыть', webAppUrl: 'https://x' });

    expect(info).toHaveBeenCalledWith(
      { chatId: 111, text: 'Новая покупка: AT&T', button: 'Открыть' },
      'Telegram offline: message not sent',
    );
  });
});
