import { beforeEach, describe, expect, it } from 'vitest';
import { silentLogger } from '../lib/logger.js';
import { ADMIN_IDS, BUYER, createTestContext, type TestContext } from '../test/fixtures.js';
import { SUBSCRIPTION_CACHE_TTL_MS, SubscriptionService, isSubscribedMember } from './subscription-service.js';

let ctx: TestContext;

beforeEach(() => {
  ctx = createTestContext();
});

describe('NotificationService', () => {
  it('notifies every admin with the escaped buyer profile', async () => {
    const order = await ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'SBP' });

    await ctx.notifications.purchaseCompleted(order, { ...BUYER, firstName: 'Иван <b>' }, false);

    expect(ctx.sender.sent.map((message) => message.chatId)).toEqual(ADMIN_IDS);
    expect(ctx.sender.sent[0]?.html).toContain('Иван &lt;b&gt;');
    expect(ctx.sender.sent[0]?.html).toContain('@ivan');
  });

  it('keeps notifying other admins when one admin is unreachable', async () => {
    ctx.sender.failFor.add(ADMIN_IDS[0] as number);
    const order = await ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'SBP' });

    await ctx.notifications.purchaseCompleted(order, BUYER, false);

    expect(ctx.sender.sent.map((message) => message.chatId)).toEqual([ADMIN_IDS[1]]);
  });

  it('swallows buyer notification failures', async () => {
    ctx.sender.failFor.add(BUYER.id);
    const order = await ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'SBP' });
    await expect(ctx.notifications.notifyBuyerPaid(order)).resolves.toBeUndefined();
  });

  it('marks sandbox purchases and labels methods of older orders', async () => {
    const order = await ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'SBP' });
    await ctx.notifications.purchaseCompleted({ ...order, paymentMethod: 'CRYPTO' }, null, true);
    const html = ctx.sender.sent[0]?.html ?? '';
    expect(html).toContain('тестовый платёж');
    expect(html).toContain('Крипта');
    expect(html).toContain(`id <code>${BUYER.id}</code>`);
  });
});

describe('SubscriptionService', () => {
  it('recognises member statuses', () => {
    expect(isSubscribedMember({ status: 'member' })).toBe(true);
    expect(isSubscribedMember({ status: 'creator' })).toBe(true);
    expect(isSubscribedMember({ status: 'restricted', isMember: true })).toBe(true);
    expect(isSubscribedMember({ status: 'restricted', isMember: false })).toBe(false);
    expect(isSubscribedMember({ status: 'left' })).toBe(false);
    expect(isSubscribedMember({ status: 'kicked' })).toBe(false);
  });

  it('caches results and bypasses the cache on force', async () => {
    ctx.members.set(BUYER.id, { status: 'left' });
    expect(await ctx.subscription.isSubscribed(BUYER.id)).toBe(false);

    ctx.members.set(BUYER.id, { status: 'member' });
    expect(await ctx.subscription.isSubscribed(BUYER.id)).toBe(false);
    expect(await ctx.subscription.isSubscribed(BUYER.id, { force: true })).toBe(true);

    ctx.members.set(BUYER.id, { status: 'left' });
    ctx.clock.advance(SUBSCRIPTION_CACHE_TTL_MS);
    expect(await ctx.subscription.isSubscribed(BUYER.id)).toBe(false);
  });

  it('shares one Telegram request between parallel checks', async () => {
    let calls = 0;
    const service = new SubscriptionService({
      channel: '@c',
      fetchMember: async () => {
        calls += 1;
        return { status: 'member' };
      },
      logger: silentLogger,
    });

    const results = await Promise.all([service.isSubscribed(1), service.isSubscribed(1), service.isSubscribed(1)]);

    expect(results).toEqual([true, true, true]);
    expect(calls).toBe(1);
  });

  it('fails closed with SUBSCRIPTION_CHECK_FAILED when Telegram errors', async () => {
    const service = new SubscriptionService({
      channel: '@c',
      fetchMember: async () => {
        throw new Error('Bad Request: member list is inaccessible');
      },
      logger: silentLogger,
    });
    await expect(service.isSubscribed(1)).rejects.toMatchObject({ code: 'SUBSCRIPTION_CHECK_FAILED' });
  });
});
