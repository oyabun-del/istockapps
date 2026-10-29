import type { DateRange } from '../repositories/repositories.js';

/** Periods of the sales report; calendar days are those of the shop's time zone. */
export const STATS_PERIODS = ['today', 'yesterday', 'week', 'days30', 'month', 'all'] as const;
export type StatsPeriod = (typeof STATS_PERIODS)[number];

/** Best sellers listed in a report. */
export const TOP_APPS_LIMIT = 5;

/** A calendar day; month is 1–12. */
export interface LocalDate {
  year: number;
  month: number;
  day: number;
}

export interface LocalDateTime extends LocalDate {
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  });
  formatters.set(timeZone, formatter);
  return formatter;
}

/** Wall clock in the time zone at this instant. */
export function zonedParts(date: Date, timeZone: string): LocalDateTime {
  const parts = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(date)
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: parts.year ?? 0,
    month: parts.month ?? 0,
    day: parts.day ?? 0,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

/** How far the time zone's wall clock is ahead of UTC at this instant. */
function offsetMs(instantMs: number, timeZone: string): number {
  const wall = zonedParts(new Date(instantMs), timeZone);
  const wallMs = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return wallMs - (instantMs - new Date(instantMs).getUTCMilliseconds());
}

/** The instant the calendar day starts in the time zone. */
export function startOfLocalDay(day: LocalDate, timeZone: string): Date {
  const wallMs = Date.UTC(day.year, day.month - 1, day.day);
  const firstGuess = wallMs - offsetMs(wallMs, timeZone);
  // The offset may change during that day (daylight saving); one correction settles it.
  return new Date(wallMs - offsetMs(firstGuess, timeZone));
}

export function addDays(day: LocalDate, days: number): LocalDate {
  const shifted = new Date(Date.UTC(day.year, day.month - 1, day.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/** "2026-10-29": sortable, so later days compare greater as strings. */
export function localDateKey(day: LocalDate): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${day.year}-${pad(day.month)}-${pad(day.day)}`;
}

/** Bounds of the period: from inclusive, to exclusive; periods that include today end at the next midnight. */
export function periodRange(period: StatsPeriod, now: Date, timeZone: string): DateRange {
  const today = zonedParts(now, timeZone);
  const daysBack = (days: number) => startOfLocalDay(addDays(today, -days), timeZone);
  const tomorrow = daysBack(-1);
  switch (period) {
    case 'today':
      return { from: daysBack(0), to: tomorrow };
    case 'yesterday':
      return { from: daysBack(1), to: daysBack(0) };
    case 'week':
      return { from: daysBack(6), to: tomorrow };
    case 'days30':
      return { from: daysBack(29), to: tomorrow };
    case 'month':
      return { from: startOfLocalDay({ ...today, day: 1 }, timeZone), to: tomorrow };
    case 'all':
      return { from: null, to: tomorrow };
  }
}

export function isStatsPeriod(value: string): value is StatsPeriod {
  return (STATS_PERIODS as readonly string[]).includes(value);
}
