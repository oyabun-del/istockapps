import { describe, expect, it } from 'vitest';
import { categorize, visibleCategories } from './app-categories.js';

const of = (name: string, id = 'app_x') => categorize({ id, name });

describe('categorize', () => {
  it.each([
    ['СберБанк Онлайн', 'banks'],
    ['Т-Банк', 'banks'],
    ['ВТБ Онлайн', 'banks'],
    ['Альфа-Банк', 'banks'],
    ['Happ Proxy Utility', 'vpn'],
    ['V2Box - V2ray Client VPN', 'vpn'],
    ['ChatGPT', 'ai'],
    ['Claude by Anthropic', 'ai'],
    ['Perplexity - Ask Anything', 'ai'],
    ['Meta AI', 'ai'],
    ['Кинопоиск', 'movies'],
    ['Okko: фильмы и сериалы', 'movies'],
    ['Netflix', 'movies'],
    ['Telegram Messenger', 'social'],
    ['WhatsApp Messenger', 'social'],
    ['OK', 'social'],
    ['ВКонтакте', 'social'],
    ['Roblox', 'games'],
    ['Brawl Stars', 'games'],
  ])('%s → %s', (name, category) => {
    expect(of(name)).toBe(category);
  });

  it('matches short names as whole words only', () => {
    expect(of('Airbnb')).toBe('other');
    expect(of('Maxim — заказ такси')).toBe('other');
    expect(of('Booking.com')).toBe('other');
  });

  it('puts unknown apps into "other"', () => {
    expect(of('Госуслуги')).toBe('other');
  });

  it('lets a manual override by id win over the name rules', () => {
    expect(categorize({ id: 'app_tg', name: 'Telegram' }, { app_tg: 'vpn' })).toBe('vpn');
  });
});

describe('visibleCategories', () => {
  it('lists "all" first and only non-empty categories in the fixed order', () => {
    expect(visibleCategories(new Set(['other', 'vpn', 'banks'])).map((c) => c.id)).toEqual([
      'all',
      'banks',
      'vpn',
      'other',
    ]);
  });

  it('hides the chips when every app falls into one category', () => {
    expect(visibleCategories(new Set(['other'])).map((c) => c.id)).toEqual(['all']);
  });
});
