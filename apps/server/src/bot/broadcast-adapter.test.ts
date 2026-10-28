import { GrammyError, type Bot } from 'grammy';
import { describe, expect, it, vi } from 'vitest';
import { classifyCopyError, createBroadcastTelegram, toInlineKeyboard } from './broadcast-adapter.js';

function apiError(code: number, description: string, retryAfter?: number): GrammyError {
  const parameters = retryAfter === undefined ? undefined : { retry_after: retryAfter };
  return new GrammyError('call failed', { ok: false, error_code: code, description, parameters }, 'copyMessage', {});
}

const SOURCE = { chatId: 7, messageId: 900 };

describe('classifyCopyError', () => {
  it.each([
    [apiError(429, 'Too Many Requests: retry after 5', 5), { kind: 'retry', afterMs: 5000 }],
    [apiError(403, 'Forbidden: bot was blocked by the user'), { kind: 'blocked' }],
    [apiError(403, 'Forbidden: user is deactivated'), { kind: 'blocked' }],
    [apiError(400, 'Bad Request: message to copy not found'), { kind: 'source_missing' }],
    [apiError(400, 'Bad Request: chat not found'), { kind: 'failed', reason: 'Bad Request: chat not found' }],
    [apiError(502, 'Bad Gateway'), { kind: 'unavailable', reason: 'Bad Gateway' }],
    [new Error('socket hang up'), { kind: 'unavailable', reason: 'socket hang up' }],
  ])('maps %s', (error, outcome) => {
    expect(classifyCopyError(error)).toEqual(outcome);
  });
});

describe('toInlineKeyboard', () => {
  it('builds url, web_app and callback buttons row by row', () => {
    const keyboard = toInlineKeyboard([
      [
        { kind: 'url', text: 'Канал', url: 'https://t.me/c' },
        { kind: 'web_app', text: 'Магазин', url: 'https://shop.example.com' },
      ],
      [{ kind: 'callback', text: 'Стоп', data: 'bc:stop:1' }],
    ]);

    expect(keyboard?.inline_keyboard).toEqual([
      [
        { text: 'Канал', url: 'https://t.me/c' },
        { text: 'Магазин', web_app: { url: 'https://shop.example.com' } },
      ],
      [{ text: 'Стоп', callback_data: 'bc:stop:1' }],
    ]);
  });

  it('sends no keyboard for no buttons', () => {
    expect(toInlineKeyboard([])).toBeUndefined();
    expect(toInlineKeyboard(undefined)).toBeUndefined();
  });
});

describe('createBroadcastTelegram', () => {
  it('copies the source message with the keyboard', async () => {
    const copyMessage = vi.fn().mockResolvedValue({ message_id: 1 });
    const telegram = createBroadcastTelegram({ api: { copyMessage } } as unknown as Bot);

    const outcome = await telegram.copy(42, SOURCE, [[{ kind: 'url', text: 'Канал', url: 'https://t.me/c' }]]);

    expect(outcome).toEqual({ kind: 'sent' });
    expect(copyMessage).toHaveBeenCalledWith(42, 7, 900, {
      reply_markup: expect.objectContaining({ inline_keyboard: [[{ text: 'Канал', url: 'https://t.me/c' }]] }),
    });
  });

  it('turns API errors into outcomes instead of throwing', async () => {
    const copyMessage = vi.fn().mockRejectedValue(apiError(403, 'Forbidden: bot was blocked by the user'));
    const telegram = createBroadcastTelegram({ api: { copyMessage } } as unknown as Bot);

    expect(await telegram.copy(42, SOURCE, [])).toEqual({ kind: 'blocked' });
  });

  it('sends and edits HTML, ignoring an edit that changes nothing', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const editMessageText = vi
      .fn()
      .mockRejectedValueOnce(apiError(400, 'Bad Request: message is not modified'))
      .mockRejectedValueOnce(apiError(400, 'Bad Request: message to edit not found'));
    const telegram = createBroadcastTelegram({ api: { sendMessage, editMessageText } } as unknown as Bot);

    await telegram.sendText(7, '<b>hi</b>');
    await expect(telegram.editText(7, 1, 'same')).resolves.toBeUndefined();
    await expect(telegram.editText(7, 1, 'gone')).rejects.toThrow(GrammyError);

    expect(sendMessage.mock.calls[0]?.[2]).toMatchObject({ parse_mode: 'HTML', reply_markup: undefined });
  });
});
