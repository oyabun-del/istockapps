import { GrammyError, InlineKeyboard, type Bot } from 'grammy';
import type { InlineButton, Keyboard } from '../domain/models.js';
import { getErrorMessage } from '../lib/app-error.js';
import type { BroadcastTelegram, CopyOutcome } from '../services/broadcast-port.js';

const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR = 500;
const MS_PER_SECOND = 1000;
/** Bot API descriptions for a copy whose source is gone. */
const SOURCE_MISSING = /message to copy not found|MESSAGE_ID_INVALID/i;
const NOT_MODIFIED = /message is not modified/i;

function toButton(button: InlineButton) {
  if (button.kind === 'callback') return InlineKeyboard.text(button.text, button.data);
  if (button.kind === 'web_app') return InlineKeyboard.webApp(button.text, button.url);
  return InlineKeyboard.url(button.text, button.url);
}

export function toInlineKeyboard(keyboard: Keyboard | undefined): InlineKeyboard | undefined {
  if (!keyboard || keyboard.length === 0) return undefined;
  return InlineKeyboard.from(keyboard.map((row) => row.map(toButton)));
}

export function classifyCopyError(error: unknown): CopyOutcome {
  // Not an API answer (network, timeout): the request never reached a verdict.
  if (!(error instanceof GrammyError)) return { kind: 'unavailable', reason: getErrorMessage(error) };
  if (error.error_code >= HTTP_SERVER_ERROR) return { kind: 'unavailable', reason: error.description };
  if (error.error_code === HTTP_TOO_MANY_REQUESTS) {
    return { kind: 'retry', afterMs: (error.parameters.retry_after ?? 1) * MS_PER_SECOND };
  }
  if (error.error_code === HTTP_FORBIDDEN) return { kind: 'blocked' };
  if (SOURCE_MISSING.test(error.description)) return { kind: 'source_missing' };
  return { kind: 'failed', reason: error.description };
}

export function createBroadcastTelegram(bot: Bot): BroadcastTelegram {
  return {
    async copy(chatId, source, keyboard) {
      try {
        await bot.api.copyMessage(chatId, source.chatId, source.messageId, { reply_markup: toInlineKeyboard(keyboard) });
        return { kind: 'sent' };
      } catch (error: unknown) {
        return classifyCopyError(error);
      }
    },
    async sendText(chatId, html, keyboard) {
      await bot.api.sendMessage(chatId, html, {
        parse_mode: 'HTML',
        reply_markup: toInlineKeyboard(keyboard),
        link_preview_options: { is_disabled: true },
      });
    },
    async editText(chatId, messageId, html, keyboard) {
      try {
        await bot.api.editMessageText(chatId, messageId, html, {
          parse_mode: 'HTML',
          reply_markup: toInlineKeyboard(keyboard),
          link_preview_options: { is_disabled: true },
        });
      } catch (error: unknown) {
        // The same counters twice in a row: nothing to change.
        if (error instanceof GrammyError && NOT_MODIFIED.test(error.description)) return;
        throw error;
      }
    },
  };
}
