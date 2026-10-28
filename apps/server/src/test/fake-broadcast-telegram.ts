import type { Keyboard, MessageRef } from '../domain/models.js';
import type { BroadcastTelegram, CopyOutcome } from '../services/broadcast-port.js';

export interface SentCopy {
  chatId: number;
  source: MessageRef;
  keyboard: Keyboard;
}

export interface SentText {
  chatId: number;
  messageId?: number;
  html: string;
  keyboard?: Keyboard;
}

/** Records every call; `outcomes` scripts what Telegram answers per chat (default: delivered). */
export class FakeBroadcastTelegram implements BroadcastTelegram {
  readonly copies: SentCopy[] = [];
  readonly texts: SentText[] = [];
  readonly edits: SentText[] = [];
  readonly outcomes = new Map<number, CopyOutcome[]>();
  /** Runs before each copy, e.g. to cancel a broadcast midway. */
  onCopy: (chatId: number) => Promise<void> = async () => undefined;

  async copy(chatId: number, source: MessageRef, keyboard: Keyboard): Promise<CopyOutcome> {
    await this.onCopy(chatId);
    const outcome = this.outcomes.get(chatId)?.shift() ?? { kind: 'sent' };
    if (outcome.kind === 'sent') this.copies.push({ chatId, source, keyboard });
    return outcome;
  }

  async sendText(chatId: number, html: string, keyboard?: Keyboard): Promise<void> {
    this.texts.push({ chatId, html, keyboard });
  }

  async editText(chatId: number, messageId: number, html: string, keyboard?: Keyboard): Promise<void> {
    this.edits.push({ chatId, messageId, html, keyboard });
  }

  /** Callback data of every button in a keyboard. */
  static actions(keyboard: Keyboard | undefined): string[] {
    return (keyboard ?? []).flat().flatMap((button) => (button.kind === 'callback' ? [button.data] : []));
  }
}
