import type { Bot, Context, NextFunction } from 'grammy';
import { AppError, getErrorMessage } from '../lib/app-error.js';
import type { Logger } from '../lib/logger.js';
import type { BroadcastService } from '../services/broadcast-service.js';
import { BROADCAST_ACTION_PATTERN, BROADCAST_TEXT, type BroadcastAction } from '../services/broadcast-ui.js';

export interface BroadcastHandlerDeps {
  adminIds?: readonly number[];
  broadcasts?: BroadcastService | null;
  logger: Logger;
}

type Ready = { adminId: number; broadcasts: BroadcastService };

/** Admins in a private chat only; everyone else is ignored, like the other admin commands. */
function admin(ctx: Context, deps: BroadcastHandlerDeps): Ready | null {
  const adminId = ctx.from?.id;
  if (adminId === undefined || ctx.chat?.type !== 'private' || !deps.broadcasts) return null;
  return deps.adminIds?.includes(adminId) ? { adminId, broadcasts: deps.broadcasts } : null;
}

function isCommand(ctx: Context): boolean {
  return ctx.message?.entities?.some((entity) => entity.type === 'bot_command' && entity.offset === 0) ?? false;
}

export async function handleBroadcastCommand(ctx: Context, deps: BroadcastHandlerDeps): Promise<void> {
  const ready = admin(ctx, deps);
  if (!ready) return;
  try {
    await ready.broadcasts.begin(ready.adminId);
  } catch (error: unknown) {
    deps.logger.error({ err: getErrorMessage(error) }, 'Broadcast command failed');
    await ctx.reply(BROADCAST_TEXT.failed);
  }
}

/** Messages of an admin composing a broadcast; anything else goes on to the next handler. */
export async function handleBroadcastMessage(ctx: Context, deps: BroadcastHandlerDeps, next: NextFunction): Promise<void> {
  const ready = admin(ctx, deps);
  const message = ctx.message;
  if (!ready || !message || isCommand(ctx)) return next();
  try {
    const isHandled = await ready.broadcasts.handleMessage(ready.adminId, {
      chatId: message.chat.id,
      messageId: message.message_id,
      text: message.text ?? message.caption,
      mediaGroupId: message.media_group_id ?? null,
    });
    if (!isHandled) await next();
  } catch (error: unknown) {
    deps.logger.error({ err: getErrorMessage(error) }, 'Broadcast message failed');
    await ctx.reply(BROADCAST_TEXT.failed);
  }
}

export async function handleBroadcastAction(ctx: Context, deps: BroadcastHandlerDeps): Promise<void> {
  const ready = admin(ctx, deps);
  const match = typeof ctx.match === 'string' ? null : ctx.match;
  const messageId = ctx.callbackQuery?.message?.message_id;
  if (!ready || !match || messageId === undefined) {
    await ctx.answerCallbackQuery();
    return;
  }
  const action = match[1] as BroadcastAction;
  try {
    await ready.broadcasts.handleAction(ready.adminId, Number(match[2]), action, messageId);
    await ctx.answerCallbackQuery(action === 'stop' ? { text: BROADCAST_TEXT.stopping } : undefined);
  } catch (error: unknown) {
    const isExpected = error instanceof AppError;
    if (!isExpected) deps.logger.error({ err: getErrorMessage(error), action }, 'Broadcast action failed');
    await ctx.answerCallbackQuery({ text: isExpected ? error.message : BROADCAST_TEXT.failed, show_alert: true });
  }
}

/** Register after the commands: the message handler sees only what they left. */
export function registerBroadcastHandlers(bot: Bot, deps: BroadcastHandlerDeps): void {
  bot.command('broadcast', (ctx) => handleBroadcastCommand(ctx, deps));
  bot.callbackQuery(BROADCAST_ACTION_PATTERN, (ctx) => handleBroadcastAction(ctx, deps));
  bot.on('message', (ctx, next) => handleBroadcastMessage(ctx, deps, next));
}
