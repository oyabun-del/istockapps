import type { DeliveryAppDto, DeliveryDto } from '@istock/shared';
import { describe, expect, it } from 'vitest';
import { REPLACING_POLL_BASE_MS, REPLACING_POLL_MAX_MS, replacingPollDelayMs } from './delivery-poll';

function app(state: DeliveryAppDto['state'], replacementInSeconds: number | null = null): DeliveryAppDto {
  return { id: `app_${state}`, name: state, state, links: null, replacementInSeconds };
}

function delivery(apps: DeliveryAppDto[]): DeliveryDto {
  return {
    expiresAt: new Date().toISOString(),
    limits: null,
    activationStartedAt: null,
    isSandbox: false,
    groups: [{ id: 'grp', state: apps[0]?.state ?? 'available', expiresAt: '', message: null, codesLeft: 3, apps }],
    isReplacing: apps.some((item) => item.state === 'replacing'),
  };
}

describe('replacingPollDelayMs', () => {
  it('does not poll when nothing is being replaced', () => {
    expect(replacingPollDelayMs(undefined, 0)).toBe(false);
    expect(replacingPollDelayMs(delivery([app('available')]), 0)).toBe(false);
  });

  it('backs off from the base pause while the due time is unknown', () => {
    const waiting = delivery([app('replacing')]);
    expect(replacingPollDelayMs(waiting, 0)).toBe(REPLACING_POLL_BASE_MS);
    expect(replacingPollDelayMs(waiting, 1)).toBe(REPLACING_POLL_BASE_MS * 2);
    expect(replacingPollDelayMs(waiting, 10)).toBe(REPLACING_POLL_MAX_MS);
  });

  it('re-reads just after the soonest replacement is due', () => {
    const held = delivery([app('replacing', 40), app('replacing', 300)]);
    expect(replacingPollDelayMs(held, 0)).toBe(45_000);
  });

  it('still checks back at least every two minutes during a long hold', () => {
    expect(replacingPollDelayMs(delivery([app('replacing', 600)]), 0)).toBe(REPLACING_POLL_MAX_MS);
  });
});
