import { describe, expect, it } from 'vitest';
import { KeyedLock } from './keyed-lock.js';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('KeyedLock', () => {
  it('runs tasks with the same key one after another', async () => {
    const lock = new KeyedLock<number>();
    const gate = deferred();
    const log: string[] = [];

    const first = lock.run(1, async () => {
      log.push('first:start');
      await gate.promise;
      log.push('first:end');
    });
    const second = lock.run(1, async () => {
      log.push('second');
    });
    await Promise.resolve();
    gate.resolve();
    await Promise.all([first, second]);

    expect(log).toEqual(['first:start', 'first:end', 'second']);
  });

  it('runs tasks with different keys in parallel', async () => {
    const lock = new KeyedLock<number>();
    const gate = deferred();
    const log: string[] = [];

    const first = lock.run(1, async () => {
      await gate.promise;
      log.push('first');
    });
    await lock.run(2, async () => {
      log.push('second');
    });
    gate.resolve();
    await first;

    expect(log).toEqual(['second', 'first']);
  });

  it('keeps going after a failed task', async () => {
    const lock = new KeyedLock<string>();

    const failed = lock.run('a', async () => {
      throw new Error('boom');
    });
    const next = lock.run('a', async () => 'ok');

    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });
});
