import { getErrorMessage } from '../lib/app-error.js';
import type { Logger } from '../lib/logger.js';

export const PAYMENT_RECONCILE_INTERVAL_MS = 60_000;

export interface PaymentReconcilerDeps {
  orders: { reconcilePayments(): Promise<void> };
  logger: Logger;
  intervalMs?: number;
}

/** Polls the payment provider for recent orders in the background, so a lost webhook never leaves a paid order unpaid. */
export class PaymentReconciler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;

  constructor(private readonly deps: PaymentReconcilerDeps) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.deps.intervalMs ?? PAYMENT_RECONCILE_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Resolves when the pass in progress (if any) is over. */
  async idle(): Promise<void> {
    await this.running;
  }

  /** A slow pass is never overlapped by the next one. */
  tick(): void {
    if (this.running) return;
    this.running = this.deps.orders
      .reconcilePayments()
      .catch((error: unknown) => {
        this.deps.logger.error({ err: getErrorMessage(error) }, 'Payment reconciliation pass failed');
      })
      .finally(() => {
        this.running = null;
      });
  }
}
