import type { Broadcast, BroadcastStatus, MessageRef } from '../domain/models.js';
import { getErrorMessage } from '../lib/app-error.js';
import type { Logger } from '../lib/logger.js';
import type { BroadcastRepository, UserRepository } from '../repositories/repositories.js';
import type { BroadcastTelegram, CopyOutcome } from './broadcast-port.js';
import { BROADCAST_KEYBOARD, BROADCAST_TEXT } from './broadcast-ui.js';

/** Recipients read and progress saved per batch: a crash repeats at most one batch. */
const BATCH_SIZE = 50;
const PROGRESS_INTERVAL_MS = 5000;
/** Attempts per recipient while Telegram is unreachable or rate-limits us. */
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;
/** After an outage (Telegram or database) the worker tries again this much later. */
const RETRY_LATER_MS = 30_000;
const MS_PER_SECOND = 1000;

export interface BroadcastRunnerDeps {
  broadcasts: BroadcastRepository;
  users: Pick<UserRepository, 'listRecipients' | 'setBotBlockedAt'>;
  telegram: BroadcastTelegram;
  logger: Logger;
  /** Copies per second; Telegram allows about 30 for bulk messages. */
  ratePerSecond: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Why a batch ended early. */
type Halt = 'source_missing' | 'unavailable' | null;

interface BatchResult {
  broadcast: Broadcast;
  halt: Halt;
}

/** Telegram stayed unreachable for one recipient; progress is saved and the worker retries later. */
class TelegramUnavailableError extends Error {}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Background worker: sends broadcasts in `sending` one at a time, at a steady rate.
 * Progress lives in the database, so a restart continues where it stopped.
 */
export class BroadcastRunner {
  private loop: Promise<void> | null = null;
  private isWakePending = false;
  private isStopped = false;
  private lastCopyAt = Number.NEGATIVE_INFINITY;
  private retryTimer: NodeJS.Timeout | null = null;
  private interruptPause: (() => void) | null = null;
  /** Cancelled by the admin: stop after the current copy instead of the current batch. */
  private readonly cancelledIds = new Set<number>();
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: BroadcastRunnerDeps) {
    this.intervalMs = MS_PER_SECOND / deps.ratePerSecond;
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? defaultSleep;
  }

  /** Resumes broadcasts left in `sending` by a previous run. */
  start(): void {
    this.isStopped = false;
    this.wake();
  }

  /** Finishes the current copy and leaves the broadcast in `sending` for the next start. */
  stop(): void {
    this.isStopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.interruptPause?.();
  }

  /** Call after a broadcast moved to `sending`; while busy, the worker checks again before idling. */
  wake(): void {
    this.isWakePending = true;
    if (this.loop || this.isStopped) return;
    this.loop = this.drain().finally(() => {
      this.loop = null;
    });
  }

  /** Call after a broadcast moved from `sending` to `cancelled`, so sending stops right away. */
  cancel(broadcastId: number): void {
    this.cancelledIds.add(broadcastId);
    this.interruptPause?.();
  }

  /** Resolves when the worker has nothing left to do (tests, graceful shutdown). */
  idle(): Promise<void> {
    return this.loop ?? Promise.resolve();
  }

  private async drain(): Promise<void> {
    while (this.isWakePending && !this.isStopped) {
      this.isWakePending = false;
      try {
        for (const broadcast of await this.deps.broadcasts.listByStatus('sending')) {
          if (this.isStopped) return;
          await this.run(broadcast);
        }
      } catch (error: unknown) {
        // Left in `sending` with its saved cursor: continue once things recover.
        this.deps.logger.error({ err: getErrorMessage(error) }, 'Broadcast worker failed, retrying later');
        this.retryLater();
        return;
      }
    }
  }

  private retryLater(): void {
    if (this.isStopped || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.wake();
    }, RETRY_LATER_MS);
    this.retryTimer.unref();
  }

  private async run(initial: Broadcast): Promise<void> {
    try {
      await this.runUntilHalted(initial);
    } finally {
      this.cancelledIds.delete(initial.id);
    }
  }

  private async runUntilHalted(initial: Broadcast): Promise<void> {
    if (!initial.source) {
      await this.finish(initial, 'failed');
      return;
    }
    let broadcast = initial;
    let lastProgressAt = this.now();
    while (!this.isStopped) {
      const current = await this.deps.broadcasts.findById(broadcast.id);
      if (current?.status !== 'sending') {
        await this.report({ ...broadcast, status: current?.status ?? 'cancelled' });
        return;
      }
      const recipients = await this.deps.users.listRecipients(broadcast.cursorUserId, BATCH_SIZE);
      if (recipients.length === 0) {
        await this.finish(broadcast, 'done');
        return;
      }
      const batch = await this.sendBatch(broadcast, initial.source, recipients);
      broadcast = await this.deps.broadcasts.update(broadcast.id, {
        cursorUserId: batch.broadcast.cursorUserId,
        sent: batch.broadcast.sent,
        blocked: batch.broadcast.blocked,
        failed: batch.broadcast.failed,
      });
      if (batch.halt === 'source_missing') {
        await this.finish(broadcast, 'failed');
        return;
      }
      if (batch.halt === 'unavailable') throw new TelegramUnavailableError(`Telegram unavailable (broadcast ${broadcast.id})`);
      if (this.now() - lastProgressAt >= PROGRESS_INTERVAL_MS) {
        lastProgressAt = this.now();
        await this.showProgress(broadcast);
      }
    }
  }

  private async sendBatch(initial: Broadcast, source: MessageRef, recipients: readonly number[]): Promise<BatchResult> {
    let broadcast = initial;
    for (const userId of recipients) {
      if (this.shouldHalt(initial.id)) break;
      const outcome = await this.copyTo(userId, source, broadcast);
      // Not counted and the cursor stays: this user gets the copy when sending resumes.
      if (!outcome) return { broadcast, halt: this.shouldHalt(initial.id) ? null : 'unavailable' };
      if (outcome.kind === 'source_missing') return { broadcast, halt: 'source_missing' };
      broadcast = { ...this.count(broadcast, outcome), cursorUserId: userId };
      await this.afterCopy(userId, outcome);
    }
    return { broadcast, halt: null };
  }

  /** null: gave up for now (Telegram unreachable, or the worker is stopping). */
  private async copyTo(userId: number, source: MessageRef, broadcast: Broadcast): Promise<CopyOutcome | null> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      if (this.shouldHalt(broadcast.id)) return null;
      await this.pace();
      const outcome = await this.deps.telegram.copy(userId, source, broadcast.buttons);
      if (outcome.kind === 'retry') await this.pause(outcome.afterMs);
      else if (outcome.kind === 'unavailable') await this.pause(BACKOFF_BASE_MS * 2 ** attempt);
      else return outcome;
    }
    return null;
  }

  private shouldHalt(broadcastId: number): boolean {
    return this.isStopped || this.cancelledIds.has(broadcastId);
  }

  private count(broadcast: Broadcast, outcome: CopyOutcome): Broadcast {
    if (outcome.kind === 'sent') return { ...broadcast, sent: broadcast.sent + 1 };
    if (outcome.kind === 'blocked') return { ...broadcast, blocked: broadcast.blocked + 1 };
    return { ...broadcast, failed: broadcast.failed + 1 };
  }

  /** Never throws: losing the batch here would send it again on resume. */
  private async afterCopy(userId: number, outcome: CopyOutcome): Promise<void> {
    if (outcome.kind === 'failed') {
      this.deps.logger.warn({ userId, err: outcome.reason }, 'Broadcast copy failed');
      return;
    }
    if (outcome.kind !== 'blocked') return;
    try {
      await this.deps.users.setBotBlockedAt(userId, new Date(this.now()));
    } catch (error: unknown) {
      this.deps.logger.warn({ userId, err: getErrorMessage(error) }, 'Failed to mark the user as blocked');
    }
  }

  /** Keeps copies at least `intervalMs` apart, however long each call took. */
  private async pace(): Promise<void> {
    const wait = this.lastCopyAt + this.intervalMs - this.now();
    if (wait > 0) await this.sleep(wait);
    this.lastCopyAt = this.now();
  }

  /** A long wait (flood control, backoff) that stop() and cancel() cut short. */
  private async pause(ms: number): Promise<void> {
    const interrupted = new Promise<void>((resolve) => {
      this.interruptPause = resolve;
    });
    await Promise.race([this.sleep(ms), interrupted]);
    this.interruptPause = null;
  }

  private async finish(broadcast: Broadcast, status: Extract<BroadcastStatus, 'done' | 'failed'>): Promise<void> {
    const finished = await this.deps.broadcasts.transition(broadcast.id, ['sending'], {
      status,
      finishedAt: new Date(this.now()),
    });
    // null: cancelled at the same moment; the report still shows what was sent.
    await this.report(finished ?? { ...broadcast, status: 'cancelled' });
  }

  private async showProgress(broadcast: Broadcast): Promise<void> {
    if (broadcast.progressMessageId === null) return;
    await this.tellAuthor(() =>
      this.deps.telegram.editText(
        broadcast.authorId,
        broadcast.progressMessageId as number,
        BROADCAST_TEXT.progress(broadcast),
        BROADCAST_KEYBOARD.progress(broadcast.id),
      ),
    );
  }

  private async report(broadcast: Broadcast): Promise<void> {
    const html = BROADCAST_TEXT.report(broadcast);
    const { authorId, progressMessageId } = broadcast;
    await this.tellAuthor(() =>
      progressMessageId === null
        ? this.deps.telegram.sendText(authorId, html)
        : this.deps.telegram.editText(authorId, progressMessageId, html),
    );
    this.deps.logger.info(
      { broadcastId: broadcast.id, status: broadcast.status, sent: broadcast.sent, blocked: broadcast.blocked, failed: broadcast.failed },
      'Broadcast finished',
    );
  }

  /** The admin's status message is informational: a failure never stops sending. */
  private async tellAuthor(send: () => Promise<void>): Promise<void> {
    try {
      await send();
    } catch (error: unknown) {
      this.deps.logger.warn({ err: getErrorMessage(error) }, 'Failed to update broadcast status for the admin');
    }
  }
}
