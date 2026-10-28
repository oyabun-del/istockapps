import type { Keyboard, MessageRef } from '../domain/models.js';

/** What happened to one copy; Bot API errors are mapped to this in the bot layer. */
export type CopyOutcome =
  | { kind: 'sent' }
  /** 403: the user blocked the bot or deleted the account. */
  | { kind: 'blocked' }
  /** The admin deleted the source message: no further copy can succeed. */
  | { kind: 'source_missing' }
  /** 429: Telegram asks to slow down. */
  | { kind: 'retry'; afterMs: number }
  /** Network error or 5xx: worth retrying, the user did nothing wrong. */
  | { kind: 'unavailable'; reason: string }
  | { kind: 'failed'; reason: string };

/** Thin port over the Bot API calls a broadcast needs (implemented with grammY). */
export interface BroadcastTelegram {
  /** Copies the message as is (formatting, links, custom emoji, media) with the keyboard attached. */
  copy(chatId: number, source: MessageRef, keyboard: Keyboard): Promise<CopyOutcome>;
  sendText(chatId: number, html: string, keyboard?: Keyboard): Promise<void>;
  /** Replaces the text and keyboard of the bot's own message; no keyboard removes it. */
  editText(chatId: number, messageId: number, html: string, keyboard?: Keyboard): Promise<void>;
}
