import { describe, expect, it } from 'vitest';
import { addDays, isStatsPeriod, localDateKey, periodRange, startOfLocalDay, zonedParts } from './stats-period.js';

const MOSCOW = 'Europe/Moscow';
/** 13:00 in Moscow (UTC+3). */
const NOW = new Date('2026-10-29T10:00:00Z');

describe('periodRange in Moscow', () => {
  it('runs today from Moscow midnight to the next one', () => {
    expect(periodRange('today', NOW, MOSCOW)).toEqual({
      from: new Date('2026-10-28T21:00:00Z'),
      to: new Date('2026-10-29T21:00:00Z'),
    });
  });

  it('already counts a new day after Moscow midnight, while it is still yesterday in UTC', () => {
    const lateNight = new Date('2026-10-29T22:30:00Z');

    expect(periodRange('today', lateNight, MOSCOW).from).toEqual(new Date('2026-10-29T21:00:00Z'));
  });

  it('covers the whole of yesterday', () => {
    expect(periodRange('yesterday', NOW, MOSCOW)).toEqual({
      from: new Date('2026-10-27T21:00:00Z'),
      to: new Date('2026-10-28T21:00:00Z'),
    });
  });

  it('counts 7 and 30 days with today included, the month from its first day', () => {
    expect(periodRange('week', NOW, MOSCOW).from).toEqual(new Date('2026-10-22T21:00:00Z'));
    expect(periodRange('days30', NOW, MOSCOW).from).toEqual(new Date('2026-09-29T21:00:00Z'));
    expect(periodRange('month', NOW, MOSCOW).from).toEqual(new Date('2026-09-30T21:00:00Z'));
  });

  it('has no lower bound for all time', () => {
    expect(periodRange('all', NOW, MOSCOW)).toEqual({ from: null, to: new Date('2026-10-29T21:00:00Z') });
  });
});

describe('calendar helpers', () => {
  it('finds midnight on both sides of a daylight saving change', () => {
    // Berlin leaves summer time (UTC+2 → UTC+1) on 25 October 2026.
    expect(startOfLocalDay({ year: 2026, month: 10, day: 25 }, 'Europe/Berlin')).toEqual(
      new Date('2026-10-24T22:00:00Z'),
    );
    expect(startOfLocalDay({ year: 2026, month: 10, day: 26 }, 'Europe/Berlin')).toEqual(
      new Date('2026-10-25T23:00:00Z'),
    );
  });

  it('reads the wall clock of the time zone', () => {
    expect(zonedParts(new Date('2026-12-31T21:30:15Z'), MOSCOW)).toEqual({
      year: 2027,
      month: 1,
      day: 1,
      hour: 0,
      minute: 30,
      second: 15,
    });
  });

  it('shifts days across months and years, and keys them sortably', () => {
    expect(addDays({ year: 2026, month: 3, day: 1 }, -1)).toEqual({ year: 2026, month: 2, day: 28 });
    expect(addDays({ year: 2026, month: 12, day: 31 }, 1)).toEqual({ year: 2027, month: 1, day: 1 });
    expect(localDateKey({ year: 2026, month: 3, day: 7 })).toBe('2026-03-07');
    expect(localDateKey({ year: 2026, month: 10, day: 9 }) < localDateKey({ year: 2026, month: 10, day: 10 })).toBe(true);
  });

  it('knows the report periods', () => {
    expect(isStatsPeriod('week')).toBe(true);
    expect(isStatsPeriod('decade')).toBe(false);
  });
});
