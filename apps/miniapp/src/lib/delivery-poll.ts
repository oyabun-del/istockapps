import type { DeliveryDto } from '@istock/shared';

/** While a replacement account is being found, re-read the delivery with a growing pause. */
export const REPLACING_POLL_BASE_MS = 15_000;
export const REPLACING_POLL_MAX_MS = 120_000;
const MAX_BACKOFF_STEPS = 3;
/** Margin after the due time, so the re-read lands once the new account is there. */
const DUE_MARGIN_MS = 5_000;
const MS_PER_SECOND = 1000;

function soonestReplacementSeconds(delivery: DeliveryDto): number | null {
  const seconds = delivery.groups
    .flatMap((group) => group.apps)
    .map((app) => (app.state === 'replacing' ? app.replacementInSeconds : null))
    .filter((value): value is number => value !== null);
  return seconds.length > 0 ? Math.min(...seconds) : null;
}

/**
 * Pause before the next read of the delivery, or false to stop polling. During a replacement hold the
 * read is timed to just after the soonest due time, yet never later than the usual maximum pause.
 */
export function replacingPollDelayMs(delivery: DeliveryDto | undefined, updateCount: number): number | false {
  if (!delivery?.isReplacing) return false;
  const dueInSeconds = soonestReplacementSeconds(delivery);
  if (dueInSeconds !== null) return Math.min(dueInSeconds * MS_PER_SECOND + DUE_MARGIN_MS, REPLACING_POLL_MAX_MS);
  const step = Math.min(updateCount, MAX_BACKOFF_STEPS);
  return Math.min(REPLACING_POLL_BASE_MS * 2 ** step, REPLACING_POLL_MAX_MS);
}
