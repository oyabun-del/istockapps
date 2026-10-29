import { afterEach, describe, expect, it, vi } from 'vitest';
import { silentLogger } from '../lib/logger.js';
import { PaymentReconciler } from './payment-reconciler.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('PaymentReconciler', () => {
  it('runs a pass on every interval until stopped', async () => {
    vi.useFakeTimers();
    const reconcilePayments = vi.fn().mockResolvedValue(undefined);
    const reconciler = new PaymentReconciler({ orders: { reconcilePayments }, logger: silentLogger, intervalMs: 1000 });

    reconciler.start();
    await vi.advanceTimersByTimeAsync(2000);
    reconciler.stop();
    await vi.advanceTimersByTimeAsync(5000);

    expect(reconcilePayments).toHaveBeenCalledTimes(2);
  });

  it('never overlaps a slow pass and survives a failed one', async () => {
    let finish = () => {};
    const reconcilePayments = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)))
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue(undefined);
    const reconciler = new PaymentReconciler({ orders: { reconcilePayments }, logger: silentLogger });

    reconciler.tick();
    reconciler.tick();
    expect(reconcilePayments).toHaveBeenCalledTimes(1);
    finish();
    await reconciler.idle();

    reconciler.tick();
    await reconciler.idle();
    reconciler.tick();
    await reconciler.idle();
    expect(reconcilePayments).toHaveBeenCalledTimes(3);
  });
});
