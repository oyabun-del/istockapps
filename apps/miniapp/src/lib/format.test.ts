import { describe, expect, it } from 'vitest';
import { formatCountdown, formatDuration, formatOrderDate, formatSubscribers, pluralRu } from './format';

const NOW = new Date(2026, 9, 15, 18, 30);

describe('formatOrderDate', () => {
  it('names today and yesterday with the time, older dates by day', () => {
    expect(formatOrderDate(new Date(2026, 9, 15, 14, 20).toISOString(), NOW)).toBe('Сегодня, 14:20');
    expect(formatOrderDate(new Date(2026, 9, 14, 9, 5).toISOString(), NOW)).toBe('Вчера, 09:05');
    expect(formatOrderDate(new Date(2026, 4, 12, 9, 5).toISOString(), NOW)).toBe('12 мая');
    expect(formatOrderDate(new Date(2025, 11, 31, 9, 5).toISOString(), NOW)).toBe('31 декабря 2025');
  });
});

describe('formatCountdown', () => {
  it('renders minutes and seconds and never goes negative', () => {
    expect(formatCountdown(14 * 60 + 46)).toBe('14:46');
    expect(formatCountdown(5)).toBe('0:05');
    expect(formatCountdown(-3)).toBe('0:00');
  });

  it('adds hours from an hour up', () => {
    expect(formatCountdown(3600)).toBe('1:00:00');
    expect(formatCountdown(6 * 3600 - 30)).toBe('5:59:30');
  });
});

describe('formatDuration', () => {
  it('speaks in hours and minutes', () => {
    expect(formatDuration(43_200)).toBe('12 ч');
    expect(formatDuration(5_400)).toBe('1 ч 30 мин');
    expect(formatDuration(600)).toBe('10 мин');
  });
});

describe('pluralRu', () => {
  it('picks the Russian plural form', () => {
    const forms = ['заказ', 'заказа', 'заказов'] as const;
    expect([1, 2, 5, 11, 21, 22, 25, 112].map((count) => pluralRu(count, forms))).toEqual([
      'заказ',
      'заказа',
      'заказов',
      'заказов',
      'заказ',
      'заказа',
      'заказов',
      'заказов',
    ]);
  });
});

describe('formatSubscribers', () => {
  it('shortens large counts and declines the noun', () => {
    // Non-breaking space keeps the number and its unit on one line.
    expect(formatSubscribers(42_800)).toBe('42,8 тыс. подписчиков');
    expect(formatSubscribers(1)).toBe('1 подписчик');
    expect(formatSubscribers(3)).toBe('3 подписчика');
  });
});
