import type { Context } from 'grammy';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../lib/app-error.js';
import { silentLogger } from '../lib/logger.js';
import { BUYER, createTestContext, type TestContext } from '../test/fixtures.js';
import type { BotDeps } from './bot.js';
import { handleSubscriptionGate } from './subscription-gate.js';

let ctx: TestContext;
let deps: BotDeps;

beforeEach(() => {
  ctx = createTestContext();
  deps = {
    webAppUrl: 'https://shop.example.com',
    channelUrl: 'https://t.me/test_channel',
    supportUrl: 'https://t.me/support',
    users: ctx.repos.users,
    subscription: ctx.subscription,
    logger: silentLogger,
    adminIds: [1],
  };
});

type Update = { text?: string; callbackData?: string; chatType?: string; isMemberUpdate?: boolean };

function fakeContext({ text = 'привет', callbackData, chatType = 'private', isMemberUpdate = false }: Update = {}) {
  const reply = vi.fn().mockResolvedValue(undefined);
  const answerCallbackQuery = vi.fn().mockResolvedValue(undefined);
  const next = vi.fn().mockResolvedValue(undefined);
  const update = isMemberUpdate
    ? {}
    : callbackData === undefined
      ? { message: { text } }
      : { callbackQuery: { data: callbackData } };
  const context = {
    from: { id: BUYER.id, first_name: BUYER.firstName, is_bot: false },
    chat: { id: BUYER.id, type: chatType },
    ...update,
    reply,
    answerCallbackQuery,
  } as unknown as Context;
  return { context, reply, answerCallbackQuery, next };
}

function keyboardJson(call: unknown[] | undefined): string {
  return JSON.stringify((call?.[1] as { reply_markup?: unknown } | undefined)?.reply_markup ?? null);
}

describe('subscription gate', () => {
  it('asks a guest to subscribe with the channel link and a check button', async () => {
    const { context, reply, next } = fakeContext({ text: 'Где мой заказ?' });

    await handleSubscriptionGate(context, deps, next);

    expect(next).not.toHaveBeenCalled();
    expect(reply.mock.calls[0]?.[0]).toContain('подпишитесь');
    expect(reply.mock.calls[0]?.[0]).toContain('https://t.me/test_channel');
    expect(keyboardJson(reply.mock.calls[0])).toContain('https://t.me/test_channel');
    expect(keyboardJson(reply.mock.calls[0])).toContain('Проверить подписку');
    expect(keyboardJson(reply.mock.calls[0])).toContain('check_subscription');
  });

  it('lets subscribers through using the cached check', async () => {
    ctx.members.set(BUYER.id, { status: 'member' });
    const check = vi.spyOn(ctx.subscription, 'isSubscribed');
    const { context, reply, next } = fakeContext();

    await handleSubscriptionGate(context, deps, next);

    expect(next).toHaveBeenCalledOnce();
    expect(reply).not.toHaveBeenCalled();
    expect(check).toHaveBeenCalledWith(BUYER.id, { force: false });
  });

  it('answers a stale button press from a guest', async () => {
    const { context, reply, answerCallbackQuery, next } = fakeContext({ callbackData: 'something_old' });

    await handleSubscriptionGate(context, deps, next);

    expect(next).not.toHaveBeenCalled();
    expect(answerCallbackQuery).toHaveBeenCalled();
    expect(reply.mock.calls[0]?.[0]).toContain('подпишитесь');
  });

  it.each([
    ['/start', { text: '/start' }],
    ['/start with an order', { text: '/start 15' }],
    ['/support', { text: '/support' }],
    ['/support with the bot name', { text: '/support@istock_bot' }],
    ['the check button', { callbackData: 'check_subscription:15' }],
    ['a group chat', { chatType: 'supergroup' }],
    ['a non-message update', { isMemberUpdate: true }],
  ])('passes %s through without checking', async (_name, update: Update) => {
    const check = vi.spyOn(ctx.subscription, 'isSubscribed');
    const { context, reply, next } = fakeContext(update);

    await handleSubscriptionGate(context, deps, next);

    expect(next).toHaveBeenCalledOnce();
    expect(reply).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
  });

  it('still gates other commands that start like open ones', async () => {
    const { context, reply, next } = fakeContext({ text: '/startover' });

    await handleSubscriptionGate(context, deps, next);

    expect(next).not.toHaveBeenCalled();
    expect(reply.mock.calls[0]?.[0]).toContain('подпишитесь');
  });

  it('lets admins through without checking', async () => {
    const check = vi.spyOn(ctx.subscription, 'isSubscribed');
    const { context, next } = fakeContext({ text: '/broadcast' });

    await handleSubscriptionGate(context, { ...deps, adminIds: [BUYER.id] }, next);

    expect(next).toHaveBeenCalledOnce();
    expect(check).not.toHaveBeenCalled();
  });

  it('reports when the subscription cannot be checked', async () => {
    vi.spyOn(ctx.subscription, 'isSubscribed').mockRejectedValue(new AppError('SUBSCRIPTION_CHECK_FAILED', 'x'));
    const { context, reply, next } = fakeContext();

    await handleSubscriptionGate(context, deps, next);

    expect(next).not.toHaveBeenCalled();
    expect(reply.mock.calls[0]?.[0]).toContain('Не удалось проверить');
  });
});
