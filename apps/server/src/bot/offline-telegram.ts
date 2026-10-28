import { htmlToText } from '../lib/html.js';
import type { Logger } from '../lib/logger.js';
import type { TelegramAdapters } from './bot.js';

export interface OfflineTelegramDeps {
  channel: string;
  logger: Logger;
}

/**
 * TELEGRAM_OFFLINE=true (development only): stands in for the Bot API so the shop runs
 * in a regular browser without a bot token. Everyone counts as subscribed, and messages
 * to admins and buyers are written to the log.
 */
export function createOfflineTelegram({ channel, logger }: OfflineTelegramDeps): TelegramAdapters {
  return {
    fetchMember: async () => ({ status: 'member' }),
    fetchChannel: async () => ({ title: channel, memberCount: 0 }),
    sender: {
      async send(chatId, html, button) {
        logger.info({ chatId, text: htmlToText(html), button: button?.text }, 'Telegram offline: message not sent');
      },
    },
    broadcast: {
      async copy(chatId, source) {
        logger.info({ chatId, source }, 'Telegram offline: broadcast copy not sent');
        return { kind: 'sent' };
      },
      async sendText(chatId, html) {
        logger.info({ chatId, text: htmlToText(html) }, 'Telegram offline: message not sent');
      },
      async editText(chatId, messageId, html) {
        logger.info({ chatId, messageId, text: htmlToText(html) }, 'Telegram offline: message not edited');
      },
    },
  };
}
