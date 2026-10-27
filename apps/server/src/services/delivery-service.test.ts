import { beforeEach, describe, expect, it } from 'vitest';
import { silentLogger } from '../lib/logger.js';
import {
  DeliveryAccessRevokedError,
  DeliveryExpiredError,
  DeliveryRateLimitedError,
} from '../providers/delivery/delivery-provider.js';
import { MOCK_CODE_AFTER_POLLS, MOCK_CODE_VALID_SECONDS } from '../providers/delivery/mock-delivery-provider.js';
import { BUYER, OTHER_USER, createPaidOrder, createTestContext, type TestContext } from '../test/fixtures.js';
import {
  HOUR_MS,
  ScriptedDeliveryProvider,
  codeWait,
  group,
  revokedGroup,
  snapshot,
} from '../test/scripted-delivery-provider.js';
import { CODE_POLL_MIN_INTERVAL_MS, DeliveryService, externalOrderId } from './delivery-service.js';

let ctx: TestContext;

beforeEach(() => {
  ctx = createTestContext();
});

async function orderWithCredentials(service = ctx.deliveryService) {
  const paid = await createPaidOrder(ctx);
  await service.confirmDownload(BUYER.id, paid.id);
  await service.getCredentials(BUYER.id, paid.id);
  return paid;
}

describe('DeliveryService happy path (mock provider)', () => {
  it('walks the order from delivery links to completion', async () => {
    const paid = await createPaidOrder(ctx);

    const delivery = await ctx.deliveryService.getDelivery(BUYER.id, paid.id);
    expect(delivery.groups).toHaveLength(1);
    expect(delivery.groups[0]?.apps[0]).toMatchObject({ id: 'sberbank', state: 'available' });
    expect(delivery.groups[0]?.apps[0]?.links?.main).toContain('/mock-install/sberbank');
    expect(delivery.isSandbox).toBe(true);

    const confirmed = await ctx.deliveryService.confirmDownload(BUYER.id, paid.id);
    expect(confirmed.status).toBe('download_confirmed');

    const credentials = await ctx.deliveryService.getCredentials(BUYER.id, paid.id);
    const groupId = delivery.groups[0]?.id ?? '';
    expect(credentials.groups).toEqual([{ groupId, login: 'demo.sberbank@example.com', password: 'Mock-Passw0rd!' }]);
    expect((await ctx.repos.orders.findById(paid.id))?.status).toBe('credentials_issued');

    const wait = await ctx.deliveryService.startCode(BUYER.id, paid.id, groupId);
    expect(wait).toMatchObject({ status: 'active', code: null, groupId });

    let status = wait;
    for (let poll = 0; poll < MOCK_CODE_AFTER_POLLS; poll += 1) {
      ctx.clock.advance(CODE_POLL_MIN_INTERVAL_MS);
      status = await ctx.deliveryService.getCodeWait(BUYER.id, paid.id, wait.id);
    }
    expect(status.status).toBe('succeeded');
    expect(status.code).toMatch(/^\d{6}$/);
    expect(status.codeExpiresAt).toBe(
      new Date(ctx.clock.current.getTime() + MOCK_CODE_VALID_SECONDS * 1000).toISOString(),
    );
    expect((await ctx.repos.orders.findById(paid.id))?.codeReceivedAt).toEqual(ctx.clock.current);

    const completed = await ctx.deliveryService.complete(BUYER.id, paid.id);
    expect(completed.status).toBe('completed');
  });

  it('keeps confirm, credentials, code skip and complete idempotent', async () => {
    const paid = await orderWithCredentials();

    expect((await ctx.deliveryService.confirmDownload(BUYER.id, paid.id)).status).toBe('credentials_issued');
    expect((await ctx.deliveryService.getCredentials(BUYER.id, paid.id)).groups).toHaveLength(1);
    const skipped = await ctx.deliveryService.skipCode(BUYER.id, paid.id);
    ctx.clock.advance(HOUR_MS);
    expect((await ctx.deliveryService.skipCode(BUYER.id, paid.id)).codeReceivedAt).toEqual(skipped.codeReceivedAt);
    await ctx.deliveryService.complete(BUYER.id, paid.id);
    expect((await ctx.deliveryService.complete(BUYER.id, paid.id)).status).toBe('completed');
  });
});

describe('DeliveryService code step', () => {
  it('keeps the last step locked until a code was received or skipped', async () => {
    const paid = await orderWithCredentials();

    await expect(ctx.deliveryService.complete(BUYER.id, paid.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });

    const skipped = await ctx.deliveryService.skipCode(BUYER.id, paid.id);
    expect(skipped.codeReceivedAt).toEqual(ctx.clock.current);
    expect((await ctx.deliveryService.complete(BUYER.id, paid.id)).status).toBe('completed');
  });

  it('records a received code once', async () => {
    const paid = await orderWithCredentials();
    const groupId = (await ctx.deliveryService.getDelivery(BUYER.id, paid.id)).groups[0]?.id ?? '';
    const wait = await ctx.deliveryService.startCode(BUYER.id, paid.id, groupId);

    for (let poll = 0; poll < MOCK_CODE_AFTER_POLLS + 2; poll += 1) {
      ctx.clock.advance(CODE_POLL_MIN_INTERVAL_MS);
      await ctx.deliveryService.getCodeWait(BUYER.id, paid.id, wait.id);
    }

    const events = ctx.repos.orderEvents.events.filter((event) => event.type === 'code_received');
    expect(events).toHaveLength(1);
    expect((await ctx.repos.orders.findById(paid.id))?.codeReceivedAt).not.toBeNull();
  });

  it('refuses to skip the code before credentials or for another buyer', async () => {
    const paid = await createPaidOrder(ctx);
    await expect(ctx.deliveryService.skipCode(BUYER.id, paid.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });

    await ctx.deliveryService.confirmDownload(BUYER.id, paid.id);
    await ctx.deliveryService.getCredentials(BUYER.id, paid.id);
    await expect(ctx.deliveryService.skipCode(OTHER_USER.id, paid.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('DeliveryService guards', () => {
  it('refuses everything for unpaid orders', async () => {
    const order = await ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'SBP' });
    const service = ctx.deliveryService;

    await expect(service.getDelivery(BUYER.id, order.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(service.confirmDownload(BUYER.id, order.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(service.getCredentials(BUYER.id, order.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(service.startCode(BUYER.id, order.id, 'grp')).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(service.complete(BUYER.id, order.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('requires download confirmation before credentials', async () => {
    const paid = await createPaidOrder(ctx);
    await expect(ctx.deliveryService.getCredentials(BUYER.id, paid.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('never exposes the delivery or credentials of another user', async () => {
    const paid = await orderWithCredentials();
    await expect(ctx.deliveryService.getDelivery(OTHER_USER.id, paid.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(ctx.deliveryService.getCredentials(OTHER_USER.id, paid.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('DeliveryService with Install-IOS semantics', () => {
  let provider: ScriptedDeliveryProvider;
  let service: DeliveryService;

  beforeEach(() => {
    provider = new ScriptedDeliveryProvider();
    service = new DeliveryService({ repos: ctx.repos, delivery: provider, logger: silentLogger, now: ctx.clock.now });
  });

  it('creates the delivery once with the stable external id and the app id only', async () => {
    const paid = await createPaidOrder(ctx);

    await service.getDelivery(BUYER.id, paid.id);
    await service.getDelivery(BUYER.id, paid.id);

    expect(provider.calls[0]).toEqual({ method: 'createDelivery', args: [`istock-${paid.paymentOrderId}`, ['sberbank']] });
    expect(externalOrderId(paid)).toBe(`istock-${paid.paymentOrderId}`);
    expect(provider.count('createDelivery')).toBe(1);
    expect(provider.count('getDelivery')).toBe(1);
    const stored = await ctx.repos.orders.findById(paid.id);
    expect(stored).toMatchObject({ deliveryRef: 'ord_1', deliveryExpiresAt: provider.current.expiresAt });
  });

  it('shares one refresh between concurrent requests', async () => {
    const paid = await createPaidOrder(ctx);
    await Promise.all([service.getDelivery(BUYER.id, paid.id), service.getDelivery(BUYER.id, paid.id)]);
    expect(provider.count('createDelivery')).toBe(1);
  });

  it('closes only the blocked group and keeps the other one working', async () => {
    const paid = await createPaidOrder(ctx);
    provider.current = snapshot([revokedGroup('grp_a', ['app_main']), group('grp_b', ['app_extra'])]);

    const delivery = await service.getDelivery(BUYER.id, paid.id);

    expect(delivery.groups.map((item) => [item.id, item.state])).toEqual([
      ['grp_a', 'revoked'],
      ['grp_b', 'available'],
    ]);
    expect(delivery.groups[0]?.apps[0]?.links).toBeNull();
    expect(delivery.groups[0]?.message).toBe('Учётка заблокирована');
    expect(delivery.groups[1]?.apps[0]?.links).not.toBeNull();
  });

  it('shows "replacing" while a free replacement is pending, then only the new links', async () => {
    const paid = await createPaidOrder(ctx);
    provider.current = snapshot([revokedGroup('grp_a', ['app_main'])], { replacingAppIds: new Set(['app_main']) });

    const pending = await service.getDelivery(BUYER.id, paid.id);
    expect(pending.isReplacing).toBe(true);
    expect(pending.groups[0]?.apps[0]?.state).toBe('replacing');

    // The API keeps the old revoked group and adds a new one; the optional replacement block is gone.
    provider.current = snapshot([revokedGroup('grp_a', ['app_main']), group('grp_new', ['app_main'])]);
    const replaced = await service.getDelivery(BUYER.id, paid.id);

    expect(replaced.isReplacing).toBe(false);
    expect(replaced.groups).toHaveLength(1);
    expect(replaced.groups[0]).toMatchObject({ id: 'grp_new', state: 'available', message: null });
    expect(provider.count('createDelivery')).toBe(1);
  });

  it('uses the individual group deadline instead of a fixed window', async () => {
    const paid = await createPaidOrder(ctx);
    const soon = new Date(ctx.clock.current.getTime() + HOUR_MS);
    provider.current = snapshot([group('grp_a', ['app_main'], { expiresAt: soon }), group('grp_b', ['app_extra'])]);

    ctx.clock.advance(2 * HOUR_MS);
    const delivery = await service.getDelivery(BUYER.id, paid.id);

    expect(delivery.groups.map((item) => item.state)).toEqual(['expired', 'available']);
    expect(delivery.groups[0]?.expiresAt).toBe(soon.toISOString());
  });

  it('never shows credentials of a revoked group, even with HTTP 200', async () => {
    const paid = await createPaidOrder(ctx);
    await service.confirmDownload(BUYER.id, paid.id);
    provider.current = snapshot([revokedGroup('grp_a', ['app_main']), group('grp_b', ['app_extra'])]);
    provider.credentials = [
      { groupId: 'grp_a', login: '', password: '', isRevoked: true },
      { groupId: 'grp_b', login: 'b@example.com', password: 'pass-b', isRevoked: false },
    ];

    const credentials = await service.getCredentials(BUYER.id, paid.id);

    expect(credentials.groups).toEqual([{ groupId: 'grp_b', login: 'b@example.com', password: 'pass-b' }]);
  });

  it('refuses credentials when every group is revoked instead of reusing an old password', async () => {
    const paid = await orderWithCredentials(service);
    provider.current = snapshot([revokedGroup('grp_a', ['app_main'])]);
    provider.credentials = [{ groupId: 'grp_a', login: '', password: '', isRevoked: true }];

    await expect(service.getCredentials(BUYER.id, paid.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('shows a changed password on the next request', async () => {
    const paid = await orderWithCredentials(service);
    provider.credentials = [{ groupId: 'grp_a', login: 'a@example.com', password: 'new-pass', isRevoked: false }];

    const credentials = await service.getCredentials(BUYER.id, paid.id);

    expect(credentials.groups[0]?.password).toBe('new-pass');
  });

  it('re-reads the delivery when the groups changed between the two requests', async () => {
    const paid = await orderWithCredentials(service);
    provider.queuedSnapshots = [snapshot([group('grp_a', ['app_main'])])];
    provider.current = snapshot([group('grp_new', ['app_main'])]);
    provider.credentials = [{ groupId: 'grp_new', login: 'n@example.com', password: 'pass-n', isRevoked: false }];

    const credentials = await service.getCredentials(BUYER.id, paid.id);

    expect(credentials.groups).toEqual([{ groupId: 'grp_new', login: 'n@example.com', password: 'pass-n' }]);
  });

  it('turns on the wait, stores only ids and updates the shortened deadline', async () => {
    const paid = await orderWithCredentials(service);
    const shortened = new Date(ctx.clock.current.getTime() + HOUR_MS);
    provider.nextWait = codeWait({ orderExpiresAt: shortened });

    const wait = await service.startCode(BUYER.id, paid.id, 'grp_a');

    expect(wait).toMatchObject({ id: 'wait_1', status: 'active', groupId: 'grp_a', code: null });
    expect((await ctx.repos.orders.findById(paid.id))?.deliveryExpiresAt).toEqual(shortened);
    const attempt = await ctx.repos.codeWaits.findLatest(paid.id, 'grp_a');
    expect(attempt).toMatchObject({ waitId: 'wait_1' });
    expect(Object.keys(attempt ?? {})).not.toContain('code');
  });

  it('resumes the running wait on a second tap instead of starting another', async () => {
    const paid = await orderWithCredentials(service);
    await service.startCode(BUYER.id, paid.id, 'grp_a');

    await service.startCode(BUYER.id, paid.id, 'grp_a');

    expect(provider.count('startCodeWait')).toBe(1);
  });

  it('starts a new attempt when the previous wait can no longer be read', async () => {
    const paid = await orderWithCredentials(service);
    await service.startCode(BUYER.id, paid.id, 'grp_a');
    ctx.clock.advance(CODE_POLL_MIN_INTERVAL_MS);
    provider.waitStatus = new Error('wait not found');
    provider.nextWait = codeWait({ id: 'wait_2' });

    const wait = await service.startCode(BUYER.id, paid.id, 'grp_a');

    expect(wait.id).toBe('wait_2');
    expect(provider.count('startCodeWait')).toBe(2);
  });

  it('retries an unconfirmed attempt with the same idempotency key', async () => {
    const paid = await orderWithCredentials(service);
    provider.nextWait = new Error('socket hang up');
    await expect(service.startCode(BUYER.id, paid.id, 'grp_a')).rejects.toMatchObject({ code: 'DELIVERY_PROVIDER_ERROR' });

    provider.nextWait = codeWait();
    await service.startCode(BUYER.id, paid.id, 'grp_a');

    const keys = provider.calls.filter((call) => call.method === 'startCodeWait').map((call) => call.args[2]);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('uses a new key and the new group id after a replacement', async () => {
    const paid = await orderWithCredentials(service);
    await service.startCode(BUYER.id, paid.id, 'grp_a');
    provider.current = snapshot([revokedGroup('grp_a', ['app_main']), group('grp_new', ['app_main'])]);
    provider.credentials = [{ groupId: 'grp_new', login: 'n@example.com', password: 'p', isRevoked: false }];

    await expect(service.startCode(BUYER.id, paid.id, 'grp_a')).rejects.toMatchObject({ code: 'INVALID_STATE' });
    provider.nextWait = codeWait({ id: 'wait_2' });
    await service.startCode(BUYER.id, paid.id, 'grp_new');

    const starts = provider.calls.filter((call) => call.method === 'startCodeWait');
    expect(starts.map((call) => call.args[1])).toEqual(['grp_a', 'grp_new']);
    expect(starts[0]?.args[2]).not.toBe(starts[1]?.args[2]);
  });

  it('stops the attempt when the API answers 409 access_revoked', async () => {
    const paid = await orderWithCredentials(service);
    provider.nextWait = new DeliveryAccessRevokedError();

    await expect(service.startCode(BUYER.id, paid.id, 'grp_a')).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('does not start a wait once the group has used all its codes', async () => {
    const paid = await orderWithCredentials(service);
    provider.current = snapshot([group('grp_a', ['app_main'], { codesUsed: 3 })]);

    await expect(service.startCode(BUYER.id, paid.id, 'grp_a')).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    expect(provider.count('startCodeWait')).toBe(0);
  });

  it('polls a wait at most once per second', async () => {
    const paid = await orderWithCredentials(service);
    await service.startCode(BUYER.id, paid.id, 'grp_a');

    await service.getCodeWait(BUYER.id, paid.id, 'wait_1');
    await service.getCodeWait(BUYER.id, paid.id, 'wait_1');
    expect(provider.count('getCodeWait')).toBe(1);

    ctx.clock.advance(CODE_POLL_MIN_INTERVAL_MS);
    await service.getCodeWait(BUYER.id, paid.id, 'wait_1');
    expect(provider.count('getCodeWait')).toBe(2);
  });

  it('returns the code only while the wait succeeded', async () => {
    const paid = await orderWithCredentials(service);
    await service.startCode(BUYER.id, paid.id, 'grp_a');

    provider.waitStatus = codeWait({ status: 'succeeded', code: '123456', validForSeconds: 45 });
    const ready = await service.getCodeWait(BUYER.id, paid.id, 'wait_1');
    expect(ready).toMatchObject({ code: '123456', codeExpiresAt: new Date(ctx.clock.current.getTime() + 45_000).toISOString() });

    ctx.clock.advance(CODE_POLL_MIN_INTERVAL_MS);
    provider.waitStatus = codeWait({ status: 'cancelled', code: '123456', isRevoked: true });
    const cancelled = await service.getCodeWait(BUYER.id, paid.id, 'wait_1');
    expect(cancelled).toMatchObject({ status: 'cancelled', code: null, codeExpiresAt: null });
  });

  it('rejects a wait id that belongs to another order', async () => {
    const paid = await orderWithCredentials(service);
    await expect(service.getCodeWait(BUYER.id, paid.id, 'wait_foreign')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(provider.count('getCodeWait')).toBe(0);
  });

  it('maps rate limits, expiry and outages to clear errors', async () => {
    const paid = await orderWithCredentials(service);
    await service.startCode(BUYER.id, paid.id, 'grp_a');

    provider.waitStatus = new DeliveryRateLimitedError(12);
    await expect(service.getCodeWait(BUYER.id, paid.id, 'wait_1')).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      message: expect.stringContaining('12 с'),
    });

    ctx.clock.advance(CODE_POLL_MIN_INTERVAL_MS);
    provider.waitStatus = new DeliveryExpiredError();
    await expect(service.getCodeWait(BUYER.id, paid.id, 'wait_1')).rejects.toMatchObject({ code: 'INVALID_STATE' });

    ctx.clock.advance(CODE_POLL_MIN_INTERVAL_MS);
    provider.waitStatus = new Error('api down');
    await expect(service.getCodeWait(BUYER.id, paid.id, 'wait_1')).rejects.toMatchObject({
      code: 'DELIVERY_PROVIDER_ERROR',
    });
  });
});
