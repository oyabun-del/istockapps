import { addDays, localDateKey, zonedParts, type StatsPeriod } from '../domain/stats-period.js';
import { getErrorMessage } from '../lib/app-error.js';
import type { Logger } from '../lib/logger.js';
import type { SettingRepository } from '../repositories/repositories.js';

export const DAILY_REPORT_KEY = 'daily_report.last_date';
export const DAILY_REPORT_CHECK_INTERVAL_MS = 60_000;
const MINUTES_PER_HOUR = 60;
const HEADING = '🌙 Итоги дня';

/** Wall clock time in the shop's time zone. */
export interface TimeOfDay {
  hour: number;
  minute: number;
}

export interface DailyReportDeps {
  stats: { reportText(period: StatsPeriod, heading: string): Promise<string> };
  settings: SettingRepository;
  /** Resolves to how many admins got the report. */
  notifyAdmins: (html: string) => Promise<number>;
  timeZone: string;
  reportAt: TimeOfDay;
  logger: Logger;
  now?: () => Date;
  intervalMs?: number;
}

/**
 * Sends the day's sales to the admins once a day at `reportAt`. The last reported day is kept in the
 * database, so a restart never repeats a report; if the server was down at report time, yesterday's
 * report goes out on the next start instead.
 */
export class DailyReportScheduler {
  private readonly now: () => Date;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;

  constructor(private readonly deps: DailyReportDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.deps.intervalMs ?? DAILY_REPORT_CHECK_INTERVAL_MS);
    this.timer.unref();
    this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Resolves when the check in progress (if any) is over. */
  async idle(): Promise<void> {
    await this.running;
  }

  /** A slow check is never overlapped by the next one. */
  tick(): void {
    if (this.running) return;
    this.running = this.runOnce()
      .catch((error: unknown) => {
        this.deps.logger.error({ err: getErrorMessage(error) }, 'Daily report failed');
      })
      .finally(() => {
        this.running = null;
      });
  }

  async runOnce(): Promise<void> {
    const wall = zonedParts(this.now(), this.deps.timeZone);
    const today = localDateKey(wall);
    const yesterday = localDateKey(addDays(wall, -1));
    const last = await this.deps.settings.get(DAILY_REPORT_KEY);
    const { hour, minute } = this.deps.reportAt;
    const isDue = wall.hour * MINUTES_PER_HOUR + wall.minute >= hour * MINUTES_PER_HOUR + minute;

    if (isDue) {
      if (last !== today) await this.send(last, today, 'today');
      return;
    }
    // Missed yesterday's report time (server down): send that day in full. Never on the very first run.
    if (last !== null && last < yesterday) await this.send(last, yesterday, 'yesterday');
  }

  private async send(last: string | null, day: string, period: StatsPeriod): Promise<void> {
    const html = await this.deps.stats.reportText(period, HEADING);
    // Claim the day first: a second instance or an overlapping restart must not send it again.
    if (!(await this.deps.settings.compareAndSet(DAILY_REPORT_KEY, last, day))) return;
    const delivered = await this.deps.notifyAdmins(html);
    if (delivered > 0) {
      this.deps.logger.info({ day, delivered }, 'Daily report sent');
      return;
    }
    // Nobody got it (Telegram down): give the day back so the next check sends it again.
    // The very first report has no previous day to return to and is not retried.
    if (last !== null) await this.deps.settings.compareAndSet(DAILY_REPORT_KEY, day, last);
    this.deps.logger.error({ day }, 'Daily report reached no admin');
  }
}
