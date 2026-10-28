import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Broadcast, BroadcastButton, Keyboard } from '../domain/models.js';
import { silentLogger } from '../lib/logger.js';
import { createMemoryRepositories, type MemoryRepositories } from '../repositories/memory/memory-repositories.js';
import { FakeBroadcastTelegram } from '../test/fake-broadcast-telegram.js';
import { BroadcastRunner, type BroadcastRunnerDeps } from './broadcast-runner.js';

const ADMIN = 7;
const SOURCE = { chatId: ADMIN, messageId: 900 };
const PROGRESS_MESSAGE = 901;
const BUTTONS: Keyboard<BroadcastButton> = [[{ kind: 'url', text: 'Канал', url: 'https://t.me/channel' }]];

let repos: MemoryRepositories;
let telegram: FakeBroadcastTelegram;
let clock: number;
let sleep: ReturnType<typeof vi.fn<(ms: number) => Promise<void>>>;

beforeEach(() => {
  repos = createMemoryRepositories();
  telegram = new FakeBroadcastTelegram();
  clock = 0;
  sleep = vi.fn(async (ms: number) => {
    clock += ms;
  });
});

function createRunner(overrides: Partial<BroadcastRunnerDeps> = {}): BroadcastRunner {
  return new BroadcastRunner({
    broadcasts: repos.broadcasts,
    users: repos.users,
    telegram,
    logger: silentLogger,
    ratePerSecond: 25,
    now: () => clock,
    sleep,
    ...overrides,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

async function seedUsers(count: number): Promise<number[]> {
  const ids = Array.from({ length: count }, (_, index) => 1000 + index);
  for (const id of ids) {
    await repos.users.upsert({ id, firstName: `U${id}`, lastName: null, username: null, photoUrl: null });
  }
  return ids;
}

async function seedSending(patch: Partial<Broadcast> = {}): Promise<Broadcast> {
  const draft = await repos.broadcasts.create(ADMIN);
  const sending = await repos.broadcasts.transition(draft.id, ['awaiting_content'], {
    status: 'sending',
    source: SOURCE,
    buttons: BUTTONS,
    total: await repos.users.countRecipients(),
    progressMessageId: PROGRESS_MESSAGE,
    startedAt: new Date(0),
    ...patch,
  });
  if (!sending) throw new Error('seed failed');
  return sending;
}

async function runToEnd(runner: BroadcastRunner): Promise<void> {
  runner.start();
  await runner.idle();
}

describe('BroadcastRunner', () => {
  it('copies the message with its buttons to every recipient and reports the result', async () => {
    const ids = await seedUsers(120);
    const broadcast = await seedSending();

    await runToEnd(createRunner());

    expect(telegram.copies.map((copy) => copy.chatId)).toEqual(ids);
    expect(telegram.copies[0]).toEqual({ chatId: ids[0], source: SOURCE, keyboard: BUTTONS });
    const saved = await repos.broadcasts.findById(broadcast.id);
    expect(saved).toMatchObject({ status: 'done', sent: 120, blocked: 0, failed: 0, cursorUserId: ids.at(-1) });
    expect(saved?.finishedAt).not.toBeNull();
    const report = telegram.edits.at(-1);
    expect(report).toMatchObject({ chatId: ADMIN, messageId: PROGRESS_MESSAGE, keyboard: undefined });
    expect(report?.html).toContain('завершена');
  });

  it('counts users who blocked the bot and skips them next time', async () => {
    const [first, second] = await seedUsers(2);
    telegram.outcomes.set(first as number, [{ kind: 'blocked' }]);
    telegram.outcomes.set(second as number, [{ kind: 'failed', reason: 'Bad Request: chat not found' }]);
    const broadcast = await seedSending();

    await runToEnd(createRunner());

    expect(await repos.broadcasts.findById(broadcast.id)).toMatchObject({ sent: 0, blocked: 1, failed: 1 });
    expect(await repos.users.listRecipients(null, 10)).toEqual([second]);
  });

  it('waits as long as Telegram asks on 429 and then retries', async () => {
    const [id] = await seedUsers(1);
    telegram.outcomes.set(id as number, [{ kind: 'retry', afterMs: 3000 }]);
    const broadcast = await seedSending();

    await runToEnd(createRunner());

    expect(sleep).toHaveBeenCalledWith(3000);
    expect(await repos.broadcasts.findById(broadcast.id)).toMatchObject({ sent: 1, failed: 0 });
  });

  it('pauses instead of skipping users while Telegram is unreachable, then resumes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const [first, second, third] = await seedUsers(3);
    const outage = Array.from({ length: 4 }, () => ({ kind: 'unavailable' as const, reason: 'socket hang up' }));
    telegram.outcomes.set(second as number, outage);
    const broadcast = await seedSending();
    const runner = createRunner();

    await runToEnd(runner);

    expect(await repos.broadcasts.findById(broadcast.id)).toMatchObject({
      status: 'sending',
      sent: 1,
      failed: 0,
      cursorUserId: first,
    });
    expect(sleep).toHaveBeenCalledWith(4000);

    vi.advanceTimersByTime(30_000);
    await runner.idle();

    expect(telegram.copies.map((copy) => copy.chatId)).toEqual([first, second, third]);
    expect((await repos.broadcasts.findById(broadcast.id))?.status).toBe('done');
  });

  it('keeps the batch when marking a blocked user fails', async () => {
    const [first, second] = await seedUsers(2);
    telegram.outcomes.set(first as number, [{ kind: 'blocked' }]);
    vi.spyOn(repos.users, 'setBotBlockedAt').mockRejectedValue(new Error('db blip'));
    const broadcast = await seedSending();

    await runToEnd(createRunner());

    expect(await repos.broadcasts.findById(broadcast.id)).toMatchObject({ status: 'done', blocked: 1, sent: 1, cursorUserId: second });
  });

  it('stops for good when the admin deleted the source message', async () => {
    const [first, second] = await seedUsers(3);
    telegram.outcomes.set(second as number, [{ kind: 'source_missing' }]);
    const broadcast = await seedSending();

    await runToEnd(createRunner());

    expect(telegram.copies.map((copy) => copy.chatId)).toEqual([first]);
    expect(await repos.broadcasts.findById(broadcast.id)).toMatchObject({ status: 'failed', sent: 1, cursorUserId: first });
    expect(telegram.edits.at(-1)?.html).toContain('исходное сообщение удалено');
  });

  it('stops between batches once the broadcast is cancelled', async () => {
    await seedUsers(120);
    const broadcast = await seedSending();
    telegram.onCopy = async () => {
      if (telegram.copies.length === 10) {
        await repos.broadcasts.transition(broadcast.id, ['sending'], { status: 'cancelled', finishedAt: new Date() });
      }
    };

    await runToEnd(createRunner());

    const saved = await repos.broadcasts.findById(broadcast.id);
    expect(saved?.status).toBe('cancelled');
    expect(saved?.sent).toBeLessThan(120);
    expect(telegram.edits.at(-1)?.html).toContain('остановлена');
  });

  it('stops right after the current copy when the admin cancels', async () => {
    await seedUsers(40);
    const broadcast = await seedSending();
    const runner = createRunner();
    telegram.onCopy = async () => {
      if (telegram.copies.length !== 3) return;
      await repos.broadcasts.transition(broadcast.id, ['sending'], { status: 'cancelled', finishedAt: new Date() });
      runner.cancel(broadcast.id);
    };

    await runToEnd(runner);

    expect(await repos.broadcasts.findById(broadcast.id)).toMatchObject({ status: 'cancelled', sent: 4, cursorUserId: 1003 });
    expect(telegram.edits.at(-1)?.html).toContain('остановлена');
  });

  it('cuts a long flood wait short on shutdown without skipping the user', async () => {
    const [first, second] = await seedUsers(2);
    telegram.outcomes.set(second as number, [{ kind: 'retry', afterMs: 60_000 }]);
    const broadcast = await seedSending();
    let runner: BroadcastRunner | null = null;
    const hangingSleep = vi.fn(async (ms: number) => {
      if (ms < 60_000) return;
      runner?.stop();
      await new Promise(() => undefined);
    });
    runner = createRunner({ sleep: hangingSleep });

    await runToEnd(runner);

    expect(await repos.broadcasts.findById(broadcast.id)).toMatchObject({ status: 'sending', sent: 1, cursorUserId: first });
  });

  it('resumes after the saved cursor', async () => {
    const ids = await seedUsers(5);
    await seedSending({ cursorUserId: ids[2], sent: 3 });

    await runToEnd(createRunner());

    expect(telegram.copies.map((copy) => copy.chatId)).toEqual(ids.slice(3));
  });

  it('keeps the broadcast sending on shutdown so the next start continues it', async () => {
    await seedUsers(10);
    const broadcast = await seedSending();
    const runner = createRunner();
    telegram.onCopy = async () => {
      if (telegram.copies.length === 4) runner.stop();
    };

    await runToEnd(runner);

    const saved = await repos.broadcasts.findById(broadcast.id);
    expect(saved).toMatchObject({ status: 'sending', sent: 5 });
    expect(saved?.cursorUserId).toBe(1004);
  });

  it('paces copies to the configured rate', async () => {
    await seedUsers(3);
    await seedSending();

    await runToEnd(createRunner({ ratePerSecond: 10 }));

    expect(clock).toBeGreaterThanOrEqual(200);
    expect(sleep.mock.calls.every(([ms]) => ms <= 100)).toBe(true);
  });

  it('updates the progress message while sending', async () => {
    await seedUsers(120);
    const broadcast = await seedSending();

    await runToEnd(createRunner({ ratePerSecond: 10 }));

    const progress = telegram.edits.filter((edit) => edit.keyboard !== undefined);
    expect(progress.length).toBeGreaterThan(0);
    expect(FakeBroadcastTelegram.actions(progress[0]?.keyboard)).toEqual([`bc:stop:${broadcast.id}`]);
  });

  it('sends the report as a new message when there is no progress message', async () => {
    await seedUsers(1);
    await seedSending({ progressMessageId: null });

    await runToEnd(createRunner());

    expect(telegram.texts.at(-1)?.html).toContain('завершена');
  });

  it('picks up a broadcast queued while another one was sending', async () => {
    await seedUsers(2);
    const first = await seedSending();
    const runner = createRunner();
    let second: Broadcast | null = null;
    telegram.onCopy = async () => {
      if (second) return;
      second = await seedSending();
      runner.wake();
    };

    await runToEnd(runner);

    expect((await repos.broadcasts.findById(first.id))?.status).toBe('done');
    expect((await repos.broadcasts.findById((second as Broadcast | null)?.id ?? 0))?.status).toBe('done');
    expect(telegram.copies).toHaveLength(4);
  });

  it('logs a storage failure and tries again later', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await seedUsers(1);
    const broadcast = await seedSending();
    const error = vi.fn();
    vi.spyOn(repos.users, 'listRecipients').mockRejectedValueOnce(new Error('db down'));
    const runner = createRunner({ logger: { ...silentLogger, error } });

    await runToEnd(runner);
    expect(error).toHaveBeenCalled();
    expect((await repos.broadcasts.findById(broadcast.id))?.status).toBe('sending');

    vi.advanceTimersByTime(30_000);
    await runner.idle();
    expect((await repos.broadcasts.findById(broadcast.id))?.status).toBe('done');
  });

  it('does not retry after shutdown', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await seedUsers(1);
    await seedSending();
    vi.spyOn(repos.users, 'listRecipients').mockRejectedValueOnce(new Error('db down'));
    const runner = createRunner();

    await runToEnd(runner);
    runner.stop();
    vi.advanceTimersByTime(30_000);
    await runner.idle();

    expect(telegram.copies).toHaveLength(0);
  });
});
