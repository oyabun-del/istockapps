import { beforeEach, describe, expect, it } from 'vitest';
import { silentLogger } from '../lib/logger.js';
import { ADMIN_IDS, BUYER, OTHER_USER, createTestContext, type TestContext } from '../test/fixtures.js';
import { SUBSCRIPTION_CACHE_TTL_MS, SubscriptionService, isSubscribedMember } from './subscription-service.js';
import { MAX_TICKETS_PER_WINDOW } from './ticket-service.js';

let ctx: TestContext;

beforeEach(() => {
  ctx = createTestContext();
});

describe('TicketService', () => {
  it('stores the ticket and notifies all admins with escaped text', async () => {
    const ticket = await ctx.tickets.create(BUYER, { message: 'Не приходит <код>' });

    expect(ticket).toMatchObject({ userId: BUYER.id, orderId: null, message: 'Не приходит <код>' });
    expect(ctx.sender.sent.map((message) => message.chatId)).toEqual(ADMIN_IDS);
    expect(ctx.sender.sent[0]?.html).toContain('Не приходит &lt;код&gt;');
    expect(ctx.sender.sent[0]?.html).toContain('@ivan');
  });

  it('links the ticket to an own order only', async () => {
    const order = await ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'SBP' });

    await expect(ctx.tickets.create(OTHER_USER, { orderId: order.id, message: 'чужой заказ' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const ticket = await ctx.tickets.create(BUYER, { orderId: order.id, message: 'мой заказ' });
    expect(ticket.orderId).toBe(order.id);
    expect(ctx.sender.sent[0]?.html).toContain(`Заказ: <b>#${order.id}</b>`);
  });

  it('limits ticket spam', async () => {
    for (let index = 0; index < MAX_TICKETS_PER_WINDOW; index += 1) {
      await ctx.tickets.create(BUYER, { message: `сообщение ${index}` });
    }
    await expect(ctx.tickets.create(BUYER, { message: 'ещё одно' })).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });
});

describe('NotificationService', () => {
  it('keeps notifying other admins when one admin is unreachable', async () => {
    ctx.sender.failFor.add(ADMIN_IDS[0] as number);

    await ctx.tickets.create(BUYER, { message: 'Помогите пожалуйста' });

    expect(ctx.sender.sent.map((message) => message.chatId)).toEqual([ADMIN_IDS[1]]);
  });

  it('swallows buyer notification failures', async () => {
    ctx.sender.failFor.add(BUYER.id);
    const order = await ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'SBP' });
    await expect(ctx.notifications.notifyBuyerPaid(order)).resolves.toBeUndefined();
  });

  it('marks sandbox purchases and falls back to user id when profile is unknown', async () => {
    const order = await ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'CRYPTO' });
    await ctx.notifications.purchaseCompleted(order, null, true);
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
