import { describe, expect, it } from 'vitest';
import { parseBroadcastButtons } from './broadcast-buttons.js';

const WEBAPP = 'https://shop.example.com';

function parse(raw: string) {
  return parseBroadcastButtons(raw, WEBAPP);
}

describe('parseBroadcastButtons', () => {
  it('reads one row per line and splits a row by |', () => {
    const result = parse('Канал - https://t.me/channel | Поддержка - https://t.me/support\n\nСайт - https://example.com');

    expect(result).toEqual({
      ok: true,
      value: [
        [
          { kind: 'url', text: 'Канал', url: 'https://t.me/channel' },
          { kind: 'url', text: 'Поддержка', url: 'https://t.me/support' },
        ],
        [{ kind: 'url', text: 'Сайт', url: 'https://example.com' }],
      ],
    });
  });

  it('opens the shop and a single app in the Mini App', () => {
    const result = parse('Открыть магазин - shop\nСкачать - app:app_42');

    expect(result).toEqual({
      ok: true,
      value: [
        [{ kind: 'web_app', text: 'Открыть магазин', url: WEBAPP }],
        [{ kind: 'web_app', text: 'Скачать', url: `${WEBAPP}#/apps/app_42` }],
      ],
    });
  });

  it('keeps dashes inside the text and accepts the dashes iOS autocorrects to', () => {
    const result = parse('Скидка - 50% — https://example.com\nТг – tg://resolve?domain=channel');

    expect(result).toEqual({
      ok: true,
      value: [
        [{ kind: 'url', text: 'Скидка - 50%', url: 'https://example.com' }],
        [{ kind: 'url', text: 'Тг', url: 'tg://resolve?domain=channel' }],
      ],
    });
  });

  it.each([
    ['', 'Пришлите хотя бы одну кнопку'],
    ['Без ссылки', 'Строка 1'],
    ['Ок - https://example.com\nПлохо - javascript:alert(1)', 'Строка 2'],
    ['Плохо - ftp://example.com', 'Строка 1'],
    ['Плохо - app:', 'Строка 1'],
    ['Плохо - app:../../x', 'Строка 1'],
    [' - https://example.com', 'Строка 1'],
  ])('rejects %j with the line number', (raw, message) => {
    const result = parse(raw);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(message);
  });

  it('enforces Telegram limits on buttons per row and in total', () => {
    const button = 'Кнопка - https://example.com';
    const wideRow = Array.from({ length: 9 }, () => button).join(' | ');
    const tooMany = Array.from({ length: 13 }, () => Array.from({ length: 8 }, () => button).join(' | ')).join('\n');

    expect(parse(wideRow)).toMatchObject({ ok: false, error: expect.stringContaining('не больше 8') });
    expect(parse(tooMany)).toMatchObject({ ok: false, error: expect.stringContaining('не больше 100') });
  });

  it('limits the button text length', () => {
    const result = parse(`${'а'.repeat(65)} - https://example.com`);

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('64') });
  });
});
