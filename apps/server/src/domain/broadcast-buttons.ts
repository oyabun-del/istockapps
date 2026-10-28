import { z } from 'zod';
import type { BroadcastButton, Keyboard } from './models.js';

/** Telegram limits for an inline keyboard. */
const MAX_BUTTONS_PER_ROW = 8;
const MAX_BUTTONS = 100;
/** Telegram cuts longer texts anyway; a clear error is better than a silent cut. */
const MAX_TEXT_LENGTH = 64;

const SHOP_TARGET = 'shop';
const APP_TARGET = /^app:([\w.-]+)$/;
/** "Text - target": the last dash surrounded by spaces splits them, so the text may contain dashes. */
const BUTTON = /^(.*\S)\s+[-–—]\s+(\S+)$/;
const buttonUrl = z.url({ protocol: /^(https?|tg)$/ });

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Admin markup → keyboard. One line is one row, buttons in a row are split by `|`:
 *
 *     Открыть магазин - shop
 *     Канал - https://t.me/channel | Поддержка - https://t.me/support
 *
 * `shop` opens the Mini App, `app:<id>` opens one app in it.
 */
export function parseBroadcastButtons(raw: string, webAppUrl: string): ParseResult<Keyboard<BroadcastButton>> {
  const lines = raw
    .split('\n')
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => line.length > 0);
  if (lines.length === 0) return { ok: false, error: 'Пришлите хотя бы одну кнопку.' };

  const rows: BroadcastButton[][] = [];
  for (const { line, number } of lines) {
    const row = parseRow(line, webAppUrl);
    if (!row.ok) return { ok: false, error: `Строка ${number}: ${row.error}` };
    rows.push(row.value);
  }

  const total = rows.reduce((sum, row) => sum + row.length, 0);
  if (total > MAX_BUTTONS) return { ok: false, error: `Кнопок ${total}, а можно не больше ${MAX_BUTTONS}.` };
  return { ok: true, value: rows };
}

function parseRow(line: string, webAppUrl: string): ParseResult<BroadcastButton[]> {
  const parts = line.split('|').map((part) => part.trim());
  if (parts.length > MAX_BUTTONS_PER_ROW) {
    return { ok: false, error: `в ряду можно не больше ${MAX_BUTTONS_PER_ROW} кнопок.` };
  }
  const buttons: BroadcastButton[] = [];
  for (const part of parts) {
    const button = parseButton(part, webAppUrl);
    if (!button.ok) return button;
    buttons.push(button.value);
  }
  return { ok: true, value: buttons };
}

function parseButton(part: string, webAppUrl: string): ParseResult<BroadcastButton> {
  const match = BUTTON.exec(part);
  const text = match?.[1]?.trim();
  const target = match?.[2];
  if (!text || !target) return { ok: false, error: `«${part}» не похоже на «Текст - ссылка».` };
  if (text.length > MAX_TEXT_LENGTH) {
    return { ok: false, error: `текст кнопки длиннее ${MAX_TEXT_LENGTH} символов.` };
  }

  if (target === SHOP_TARGET) return { ok: true, value: { kind: 'web_app', text, url: webAppUrl } };
  const appId = APP_TARGET.exec(target)?.[1];
  if (appId) return { ok: true, value: { kind: 'web_app', text, url: `${webAppUrl}#/apps/${appId}` } };
  if (buttonUrl.safeParse(target).success) return { ok: true, value: { kind: 'url', text, url: target } };
  return { ok: false, error: `«${target}» не ссылка. Подходят https://, tg://, shop и app:ID.` };
}
