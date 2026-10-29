import { beforeEach, describe, expect, it, vi } from 'vitest';
import { silentLogger } from '../lib/logger.js';
import { MemorySettingRepository } from '../repositories/memory/settings-repositories.js';
import { Clock } from '../test/fixtures.js';
import { DAILY_REPORT_KEY, DailyReportScheduler } from './daily-report-scheduler.js';

/** Moscow is UTC+3: 20:54 UTC is 23:54 there. */
const BEFORE_REPORT = '2026-10-29T20:54:00Z';
const AT_REPORT = '2026-10-29T20:55:00Z';

let clock: Clock;
let settings: MemorySettingRepository;
let reportText: ReturnType<typeof vi.fn>;
let notifyAdmins: ReturnType<typeof vi.fn>;
let scheduler: DailyReportScheduler;

beforeEach(() => {
  clock = new Clock(new Date(BEFORE_REPORT));
  settings = new MemorySettingRepository();
  reportText = vi.fn(async (period: string) => `report:${period}`);
  notifyAdmins = vi.fn().mockResolvedValue(2);
  scheduler = new DailyReportScheduler({
    stats: { reportText },
    settings,
    notifyAdmins,
    timeZone: 'Europe/Moscow',
    reportAt: { hour: 23, minute: 55 },
    logger: silentLogger,
    now: clock.now,
  });
});

describe('DailyReportScheduler', () => {
  it('waits for the report time', async () => {
    await scheduler.runOnce();

    expect(notifyAdmins).not.toHaveBeenCalled();
  });

  it('sends the day once at the report time, also after a restart', async () => {
    clock.current = new Date(AT_REPORT);

    await scheduler.runOnce();
    await scheduler.runOnce();
    clock.advance(4 * 60_000);
    await scheduler.runOnce();

    expect(reportText).toHaveBeenCalledWith('today', '🌙 Итоги дня');
    expect(notifyAdmins).toHaveBeenCalledTimes(1);
    expect(notifyAdmins).toHaveBeenCalledWith('report:today');
    expect(await settings.get(DAILY_REPORT_KEY)).toBe('2026-10-29');
  });

  it('sends the next day again', async () => {
    await settings.set(DAILY_REPORT_KEY, '2026-10-28');
    clock.current = new Date(AT_REPORT);

    await scheduler.runOnce();

    expect(notifyAdmins).toHaveBeenCalledTimes(1);
  });

  it('catches up on yesterday when the server was down at report time', async () => {
    await settings.set(DAILY_REPORT_KEY, '2026-10-27');
    clock.current = new Date('2026-10-29T07:00:00Z');

    await scheduler.runOnce();
    await scheduler.runOnce();

    expect(notifyAdmins).toHaveBeenCalledTimes(1);
    expect(notifyAdmins).toHaveBeenCalledWith('report:yesterday');
    expect(await settings.get(DAILY_REPORT_KEY)).toBe('2026-10-28');
  });

  it('does not send a catch-up report on its very first run', async () => {
    clock.current = new Date('2026-10-29T07:00:00Z');

    await scheduler.runOnce();

    expect(notifyAdmins).not.toHaveBeenCalled();
  });

  it('leaves the report to another instance that claimed the day first', async () => {
    clock.current = new Date(AT_REPORT);
    vi.spyOn(settings, 'compareAndSet').mockResolvedValue(false);

    await scheduler.runOnce();

    expect(notifyAdmins).not.toHaveBeenCalled();
  });

  it('sends the day again when no admin got the report', async () => {
    await settings.set(DAILY_REPORT_KEY, '2026-10-28');
    clock.current = new Date(AT_REPORT);
    notifyAdmins.mockResolvedValueOnce(0);

    await scheduler.runOnce();
    expect(await settings.get(DAILY_REPORT_KEY)).toBe('2026-10-28');

    await scheduler.runOnce();
    expect(notifyAdmins).toHaveBeenCalledTimes(2);
    expect(await settings.get(DAILY_REPORT_KEY)).toBe('2026-10-29');
  });

  it('retries on the next check when the report could not be built', async () => {
    clock.current = new Date(AT_REPORT);
    reportText.mockRejectedValueOnce(new Error('db down'));

    scheduler.tick();
    await scheduler.idle();
    expect(notifyAdmins).not.toHaveBeenCalled();

    scheduler.tick();
    await scheduler.idle();
    expect(notifyAdmins).toHaveBeenCalledTimes(1);
  });
});
