import { GrammyError, type Context } from 'grammy';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { silentLogger } from '../lib/logger.js';
import { STATS_CALLBACK_PATTERN } from '../services/sales-stats-service.js';
import { PAYMENTS_CALLBACK_PATTERN } from '../services/shop-admin-service.js';
import {
  handlePaymentsAction,
  handlePaymentsCommand,
  handlePromoCommand,
  handleStatsAction,
  handleStatsCommand,
  type ShopAdminHandlerDeps,
} from './shop-admin-handlers.js';

const ADMIN = 7;
const USER = 42;
const VIEW = { html: '<b>view</b>', keyboard: [[{ kind: 'callback' as const, text: 'Вчера', data: 'stats:yesterday' }]] };

let shopAdmin: {
  paymentsView: ReturnType<typeof vi.fn>;
  setPaymentsMode: ReturnType<typeof vi.fn>;
  promoCommand: ReturnType<typeof vi.fn>;
};
let salesStats: { statsView: ReturnType<typeof vi.fn> };
let deps: ShopAdminHandlerDeps;

beforeEach(() => {
  shopAdmin = {
    paymentsView: vi.fn().mockResolvedValue(VIEW),
    setPaymentsMode: vi.fn().mockResolvedValue(VIEW),
    promoCommand: vi.fn().mockResolvedValue('promo text'),
  };
  salesStats = { statsView: vi.fn().mockResolvedValue(VIEW) };
  deps = { adminIds: [ADMIN], logger: silentLogger, shopAdmin, salesStats };
});

function fakeContext({ from = ADMIN, chatType = 'private', match = '' as RegExpExecArray | string } = {}) {
  const reply = vi.fn().mockResolvedValue(undefined);
  const editMessageText = vi.fn().mockResolvedValue(undefined);
  const answerCallbackQuery = vi.fn().mockResolvedValue(undefined);
  const context = {
    from: { id: from, first_name: 'Анна', last_name: 'К', is_bot: false },
    chat: { id: from, type: chatType },
    match,
    reply,
    editMessageText,
    answerCallbackQuery,
  } as unknown as Context;
  return { context, reply, editMessageText, answerCallbackQuery };
}

function callback(pattern: RegExp, data: string): RegExpExecArray {
  const match = pattern.exec(data);
  if (!match) throw new Error(`no match for ${data}`);
  return match;
}

describe('admin-only access', () => {
  it('ignores other users and group chats', async () => {
    for (const options of [{ from: USER }, { chatType: 'group' }]) {
      const { context, reply } = fakeContext(options);
      await handleStatsCommand(context, deps);
      await handlePaymentsCommand(context, deps);
      await handlePromoCommand(context, deps);
      expect(reply).not.toHaveBeenCalled();
    }
    expect(salesStats.statsView).not.toHaveBeenCalled();
    expect(shopAdmin.promoCommand).not.toHaveBeenCalled();
  });

  it('does not switch payments for a button pressed by someone else', async () => {
    const { context, answerCallbackQuery } = fakeContext({
      from: USER,
      match: callback(PAYMENTS_CALLBACK_PATTERN, 'payments:open'),
    });

    await handlePaymentsAction(context, deps);

    expect(shopAdmin.setPaymentsMode).not.toHaveBeenCalled();
    expect(answerCallbackQuery).toHaveBeenCalledWith();
  });
});

describe('/stats', () => {
  it('answers with today and the period buttons', async () => {
    const { context, reply } = fakeContext();

    await handleStatsCommand(context, deps);

    expect(salesStats.statsView).toHaveBeenCalledWith('today');
    expect(reply).toHaveBeenCalledWith('<b>view</b>', expect.objectContaining({ parse_mode: 'HTML' }));
    expect(reply.mock.calls[0]?.[1].reply_markup.inline_keyboard[0][0]).toMatchObject({ callback_data: 'stats:yesterday' });
  });

  it('redraws the report for the pressed period', async () => {
    const { context, editMessageText, answerCallbackQuery } = fakeContext({
      match: callback(STATS_CALLBACK_PATTERN, 'stats:month'),
    });

    await handleStatsAction(context, deps);

    expect(salesStats.statsView).toHaveBeenCalledWith('month');
    expect(editMessageText).toHaveBeenCalledWith('<b>view</b>', expect.objectContaining({ parse_mode: 'HTML' }));
    expect(answerCallbackQuery).toHaveBeenCalledWith();
  });

  it('treats pressing the shown period again as done', async () => {
    const { context, editMessageText, answerCallbackQuery } = fakeContext({
      match: callback(STATS_CALLBACK_PATTERN, 'stats:today'),
    });
    editMessageText.mockRejectedValue(
      new GrammyError(
        'edit failed',
        { ok: false, error_code: 400, description: 'Bad Request: message is not modified' },
        'editMessageText',
        {},
      ),
    );

    await handleStatsAction(context, deps);

    expect(answerCallbackQuery).toHaveBeenCalledWith();
  });

  it('tells the admin when the report could not be built', async () => {
    salesStats.statsView.mockRejectedValue(new Error('db down'));
    const { context, reply } = fakeContext();

    await handleStatsCommand(context, deps);

    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Не получилось'));
  });
});

describe('/payments', () => {
  it('shows the mode switch', async () => {
    const { context, reply } = fakeContext();

    await handlePaymentsCommand(context, deps);

    expect(shopAdmin.paymentsView).toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith('<b>view</b>', expect.anything());
  });

  it('switches the mode on behalf of the admin who pressed', async () => {
    const { context, editMessageText } = fakeContext({ match: callback(PAYMENTS_CALLBACK_PATTERN, 'payments:closed') });

    await handlePaymentsAction(context, deps);

    expect(shopAdmin.setPaymentsMode).toHaveBeenCalledWith('closed', { id: ADMIN, name: 'Анна К' });
    expect(editMessageText).toHaveBeenCalled();
  });

  it('alerts the admin when switching failed', async () => {
    shopAdmin.setPaymentsMode.mockRejectedValue(new Error('db down'));
    const { context, answerCallbackQuery } = fakeContext({ match: callback(PAYMENTS_CALLBACK_PATTERN, 'payments:open') });

    await handlePaymentsAction(context, deps);

    expect(answerCallbackQuery).toHaveBeenCalledWith(expect.objectContaining({ show_alert: true }));
  });
});

describe('/promo', () => {
  it('passes the arguments on and answers in HTML', async () => {
    const { context, reply } = fakeContext({ match: 'add IOS-REVIEW 5' });

    await handlePromoCommand(context, deps);

    expect(shopAdmin.promoCommand).toHaveBeenCalledWith('add IOS-REVIEW 5', { id: ADMIN, name: 'Анна К' });
    expect(reply).toHaveBeenCalledWith('promo text', expect.objectContaining({ parse_mode: 'HTML' }));
  });
});
