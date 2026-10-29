import { InlineKeyboard, type Context, type NextFunction } from 'grammy';
import { AppError } from '../lib/app-error.js';
import type { BotDeps } from './bot.js';
import { BOT_TEXT } from './texts.js';

export const CHECK_SUBSCRIPTION = 'check_subscription';
/** Callback data: check_subscription[:<orderId>], so a deep link survives the subscribe step. */
export const CHECK_SUBSCRIPTION_PATTERN = /^check_subscription(?::(\d+))?$/;
/** /start has its own subscription step (it keeps the order deep link); /support must reach buyers who left the channel. */
const OPEN_COMMAND = /^\/(start|support)(@\w+)?(\s|$)/;

type GateDeps = Pick<BotDeps, 'channelUrl' | 'subscription' | 'adminIds'>;

function subscribeKeyboard(deps: Pick<BotDeps, 'channelUrl'>, orderId?: string): InlineKeyboard {
  return new InlineKeyboard()
    .url('📢 Подписаться на канал', deps.channelUrl)
    .row()
    .text('✅ Проверить подписку', orderId ? `${CHECK_SUBSCRIPTION}:${orderId}` : CHECK_SUBSCRIPTION);
}

export async function replySubscribeFirst(ctx: Context, deps: Pick<BotDeps, 'channelUrl'>, orderId?: string): Promise<void> {
  await ctx.reply(BOT_TEXT.subscribeFirst(deps.channelUrl), {
    parse_mode: 'HTML',
    reply_markup: subscribeKeyboard(deps, orderId),
  });
}

/** null when Telegram could not answer (usually the bot is not an admin of the channel). */
export async function safeIsSubscribed(
  deps: Pick<BotDeps, 'subscription'>,
  userId: number,
  force: boolean,
): Promise<boolean | null> {
  try {
    return await deps.subscription.isSubscribed(userId, { force });
  } catch (error: unknown) {
    if (error instanceof AppError) return null;
    throw error;
  }
}

function isOpenUpdate(ctx: Context): boolean {
  const data = ctx.callbackQuery?.data;
  if (data !== undefined) return CHECK_SUBSCRIPTION_PATTERN.test(data);
  return OPEN_COMMAND.test(ctx.message?.text ?? '');
}

/**
 * Middleware: a guest who writes to the bot or presses an old button gets the subscribe message
 * instead of an answer. Admins, group chats and non-message updates are not checked.
 */
export async function handleSubscriptionGate(ctx: Context, deps: GateDeps, next: NextFunction): Promise<void> {
  const userId = ctx.from?.id;
  const isUserAction = ctx.message !== undefined || ctx.callbackQuery !== undefined;
  const isExempt =
    userId === undefined || ctx.chat?.type !== 'private' || !isUserAction || deps.adminIds?.includes(userId) === true;
  if (isExempt || isOpenUpdate(ctx)) return next();

  const isSubscribed = await safeIsSubscribed(deps, userId, false);
  if (isSubscribed) return next();

  if (ctx.callbackQuery) await ctx.answerCallbackQuery();
  if (isSubscribed === null) {
    await ctx.reply(BOT_TEXT.checkFailed);
    return;
  }
  await replySubscribeFirst(ctx, deps);
}
