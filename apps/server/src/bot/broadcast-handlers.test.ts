import type { Context } from 'grammy';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../lib/app-error.js';
import { silentLogger } from '../lib/logger.js';
import type { BroadcastService } from '../services/broadcast-service.js';
import { BROADCAST_ACTION_PATTERN } from '../services/broadcast-ui.js';
import {
  handleBroadcastAction,
  handleBroadcastCommand,
  handleBroadcastMessage,
  type BroadcastHandlerDeps,
} from './broadcast-handlers.js';

const ADMIN = 7;
const USER = 42;

let service: { begin: ReturnType<typeof vi.fn>; handleMessage: ReturnType<typeof vi.fn>; handleAction: ReturnType<typeof vi.fn> };
let deps: BroadcastHandlerDeps;

beforeEach(() => {
  service = {
    begin: vi.fn().mockResolvedValue(undefined),
    handleMessage: vi.fn().mockResolvedValue(true),
    handleAction: vi.fn().mockResolvedValue(undefined),
  };
  deps = { adminIds: [ADMIN], broadcasts: service as unknown as BroadcastService, logger: silentLogger };
});

interface FakeOptions {
  from?: number;
  chatType?: string;
  message?: Record<string, unknown>;
  match?: RegExpMatchArray | string;
  callbackMessageId?: number;
}

function fakeContext({ from = ADMIN, chatType = 'private', message, match = '', callbackMessageId }: FakeOptions = {}) {
  const reply = vi.fn().mockResolvedValue(undefined);
  const answerCallbackQuery = vi.fn().mockResolvedValue(undefined);
  const context = {
    from: { id: from, first_name: 'A', is_bot: false },
    chat: { id: from, type: chatType },
    message,
    match,
    callbackQuery: callbackMessageId === undefined ? undefined : { message: { message_id: callbackMessageId } },
    reply,
    answerCallbackQuery,
  } as unknown as Context;
  return { context, reply, answerCallbackQuery };
}

function actionMatch(data: string): RegExpMatchArray {
  const match = BROADCAST_ACTION_PATTERN.exec(data);
  if (!match) throw new Error(`no match for ${data}`);
  return match;
}

describe('/broadcast', () => {
  it('starts a broadcast for admins only', async () => {
    await handleBroadcastCommand(fakeContext().context, deps);
    await handleBroadcastCommand(fakeContext({ from: USER }).context, deps);
    await handleBroadcastCommand(fakeContext({ chatType: 'group' }).context, deps);

    expect(service.begin).toHaveBeenCalledTimes(1);
    expect(service.begin).toHaveBeenCalledWith(ADMIN);
  });

  it('tells the admin when something broke', async () => {
    service.begin.mockRejectedValue(new Error('db down'));
    const { context, reply } = fakeContext();

    await handleBroadcastCommand(context, deps);

    expect(reply.mock.calls[0]?.[0]).toContain('логе');
  });
});

describe('admin messages', () => {
  const photo = { chat: { id: ADMIN }, message_id: 100, caption: 'Скидки', media_group_id: 'g1' };

  it('hands the message to the broadcast and stops there', async () => {
    const next = vi.fn();

    await handleBroadcastMessage(fakeContext({ message: photo }).context, deps, next);

    expect(service.handleMessage).toHaveBeenCalledWith(ADMIN, {
      chatId: ADMIN,
      messageId: 100,
      text: 'Скидки',
      mediaGroupId: 'g1',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('passes on messages that are not part of a broadcast', async () => {
    service.handleMessage.mockResolvedValue(false);
    const next = vi.fn();
    const command = { chat: { id: ADMIN }, message_id: 1, text: '/foo', entities: [{ type: 'bot_command', offset: 0, length: 4 }] };

    await handleBroadcastMessage(fakeContext({ message: { chat: { id: ADMIN }, message_id: 1, text: 'hi' } }).context, deps, next);
    await handleBroadcastMessage(fakeContext({ message: command }).context, deps, next);
    await handleBroadcastMessage(fakeContext({ from: USER, message: photo }).context, deps, next);

    expect(next).toHaveBeenCalledTimes(3);
    expect(service.handleMessage).toHaveBeenCalledTimes(1);
  });

  it('replies when handling fails', async () => {
    service.handleMessage.mockRejectedValue(new Error('db down'));
    const { context, reply } = fakeContext({ message: photo });

    await handleBroadcastMessage(context, deps, vi.fn());

    expect(reply).toHaveBeenCalled();
  });
});

describe('control buttons', () => {
  it('runs the action on the pressed message', async () => {
    const { context, answerCallbackQuery } = fakeContext({ match: actionMatch('bc:confirm:3'), callbackMessageId: 55 });

    await handleBroadcastAction(context, deps);

    expect(service.handleAction).toHaveBeenCalledWith(ADMIN, 3, 'confirm', 55);
    expect(answerCallbackQuery).toHaveBeenCalledWith(undefined);
  });

  it('confirms that a broadcast is stopping', async () => {
    const { context, answerCallbackQuery } = fakeContext({ match: actionMatch('bc:stop:3'), callbackMessageId: 55 });

    await handleBroadcastAction(context, deps);

    expect(answerCallbackQuery.mock.calls[0]?.[0]?.text).toContain('Останавливаю');
  });

  it('shows the reason of a stale button and hides internal errors', async () => {
    service.handleAction
      .mockRejectedValueOnce(new AppError('INVALID_STATE', 'Эта рассылка уже неактуальна.'))
      .mockRejectedValueOnce(new Error('secret db error'));
    const first = fakeContext({ match: actionMatch('bc:send:3'), callbackMessageId: 55 });
    const second = fakeContext({ match: actionMatch('bc:send:3'), callbackMessageId: 55 });

    await handleBroadcastAction(first.context, deps);
    await handleBroadcastAction(second.context, deps);

    expect(first.answerCallbackQuery).toHaveBeenCalledWith({ text: 'Эта рассылка уже неактуальна.', show_alert: true });
    expect(second.answerCallbackQuery.mock.calls[0]?.[0]?.text).not.toContain('secret');
  });

  it('only answers the button for anyone else', async () => {
    const { context, answerCallbackQuery } = fakeContext({ from: USER, match: actionMatch('bc:send:3'), callbackMessageId: 55 });

    await handleBroadcastAction(context, deps);

    expect(service.handleAction).not.toHaveBeenCalled();
    expect(answerCallbackQuery).toHaveBeenCalledWith();
  });
});
