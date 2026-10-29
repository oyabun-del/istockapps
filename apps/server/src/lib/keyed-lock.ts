/**
 * Runs tasks with the same key one after another; tasks with different keys run in parallel.
 * Guards check-then-act sequences within this server process (the shop runs a single instance).
 */
export class KeyedLock<K> {
  private readonly tails = new Map<K, Promise<unknown>>();

  async run<T>(key: K, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(task);
    // A failed task must not block the next one.
    const tail = result.catch(() => undefined);
    this.tails.set(key, tail);
    try {
      return await result;
    } finally {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
