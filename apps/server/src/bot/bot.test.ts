import type { Bot, Context } from 'grammy';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../lib/app-error.js';
import { silentLogger } from '../lib/logger.js';
import { BUYER, createTestContext, type TestContext } from '../test/fixtures.js';
import {
  configureBot,
  createChatMemberFetcher,
  createMessageSender,
  handleCheckSubscription,
  handleStart,
  type BotDeps,
} from './bot.js';

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
  };
});

function fakeContext(match: string | RegExpMatchArray = '') {
  const reply = vi.fn().mockResolvedValue(undefined);
  const answerCallbackQuery = vi.fn().mockResolvedValue(undefined);
  const editMessageText = vi.fn().mockResolvedValue(undefined);
  const context = {
    from: { id: BUYER.id, first_name: BUYER.firstName, username: BUYER.username, is_bot: false },
    chat: { id: BUYER.id, type: 'private' },
    match,
    reply,
    answerCallbackQuery,
    editMessageText,
  } as unknown as Context;
  return { context, reply, answerCallbackQuery, editMessageText };
}

function keyboardJson(call: unknown[] | undefined): string {
  return JSON.stringify((call?.[1] as { reply_markup?: unknown } | undefined)?.reply_markup ?? null);
}

describe('/start', () => {
  it('asks to subscribe first and saves the user', async () => {
    const { context, reply } = fakeContext();

    await handleStart(context, deps);

    expect(reply.mock.calls[0]?.[0]).toContain('подпишитесь');
    expect(keyboardJson(reply.mock.calls[0])).toContain('check_subscription');
    expect(await ctx.repos.users.findById(BUYER.id)).not.toBeNull();
  });

  it('opens the shop for subscribers and deep-links to an order', async () => {
    ctx.members.set(BUYER.id, { status: 'member' });
    const { context, reply } = fakeContext('15');

    await handleStart(context, deps);

    expect(reply.mock.calls[0]?.[0]).toContain('Привет');
    expect(keyboardJson(reply.mock.calls[0])).toContain('https://shop.example.com#/orders/15');
  });

  it('reports when the subscription cannot be checked', async () => {
    vi.spyOn(ctx.subscription, 'isSubscribed').mockRejectedValue(new AppError('SUBSCRIPTION_CHECK_FAILED', 'x'));
    const { context, reply } = fakeContext();
    await handleStart(context, deps);
    expect(reply.mock.calls[0]?.[0]).toContain('Не удалось проверить');
  });
});

describe('subscription button', () => {
  it('alerts when still not subscribed', async () => {
    const { context, answerCallbackQuery } = fakeContext();
    await handleCheckSubscription(context, deps);
    expect(answerCallbackQuery).toHaveBeenCalledWith(expect.objectContaining({ show_alert: true }));
  });

  it('keeps the order deep link through the subscription step', async () => {
    const start = fakeContext('15');
    await handleStart(start.context, deps);
    expect(keyboardJson(start.reply.mock.calls[0])).toContain('check_subscription:15');

    ctx.members.set(BUYER.id, { status: 'member' });
    const callback = fakeContext('check_subscription:15'.match(/^check_subscription(?::(\d+))?$/) as RegExpMatchArray);
    await handleCheckSubscription(callback.context, deps);
    expect(JSON.stringify(callback.editMessageText.mock.calls[0]?.[1])).toContain('#/orders/15');
  });

  it('switches the message to the shop after subscribing', async () => {
    ctx.members.set(BUYER.id, { status: 'member' });
    const { context, editMessageText } = fakeContext();
    await handleCheckSubscription(context, deps);
    expect(editMessageText.mock.calls[0]?.[0]).toContain('Привет');
  });
});

describe('Bot API adapters', () => {
  it('sends HTML messages with optional buttons', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const sender = createMessageSender({ api: { sendMessage } } as unknown as Bot);

    await sender.send(1, '<b>hi</b>', { text: 'Open', webAppUrl: 'https://shop.example.com' });
    await sender.send(2, 'plain');

    expect(sendMessage.mock.calls[0]?.[2]).toMatchObject({ parse_mode: 'HTML' });
    expect(JSON.stringify(sendMessage.mock.calls[0]?.[2])).toContain('web_app');
    expect(sendMessage.mock.calls[1]?.[2]?.reply_markup).toBeUndefined();
  });

  it('maps chat members', async () => {
    const getChatMember = vi
      .fn()
      .mockResolvedValueOnce({ status: 'member' })
      .mockResolvedValueOnce({ status: 'restricted', is_member: false });
    const fetchMember = createChatMemberFetcher({ api: { getChatMember } } as unknown as Bot);

    expect(await fetchMember('@c', 1)).toEqual({ status: 'member', isMember: undefined });
    expect(await fetchMember('@c', 1)).toEqual({ status: 'restricted', isMember: false });
  });

  it('configures the menu button and survives failures', async () => {
    const setMyCommands = vi.fn().mockResolvedValue(true);
    const setChatMenuButton = vi.fn().mockRejectedValue(new Error('https required'));
    const warn = vi.fn();
    await configureBot({ api: { setMyCommands, setChatMenuButton } } as unknown as Bot, {
      webAppUrl: 'http://localhost',
      logger: { ...silentLogger, warn },
    });
    expect(warn).toHaveBeenCalled();
  });
});
