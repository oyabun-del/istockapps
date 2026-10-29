import { Bot, GrammyError, InlineKeyboard, type Context } from 'grammy';
import type { ChannelFetcher } from '../services/channel-info-service.js';
import type { ChatMemberFetcher, SubscriptionService } from '../services/subscription-service.js';
import type { MessageSender } from '../services/notification-service.js';
import type { UserRepository } from '../repositories/repositories.js';
import { getErrorMessage } from '../lib/app-error.js';
import type { Logger } from '../lib/logger.js';
import type { BroadcastTelegram } from '../services/broadcast-port.js';
import type { BroadcastService } from '../services/broadcast-service.js';
import type { PartnerAdminService } from '../services/partner-admin-service.js';
import { createBroadcastTelegram } from './broadcast-adapter.js';
import { registerBroadcastHandlers } from './broadcast-handlers.js';
import { registerShopAdminHandlers, type ShopAdminHandlerDeps } from './shop-admin-handlers.js';
import {
  CHECK_SUBSCRIPTION_PATTERN,
  handleSubscriptionGate,
  replySubscribeFirst,
  safeIsSubscribed,
} from './subscription-gate.js';
import { BOT_TEXT } from './texts.js';

const ORDER_PAYLOAD = /^\d+$/;
const MENU_BUTTON_TEXT = 'Магазин';
const PUBLIC_COMMANDS = [
  { command: 'start', description: 'Открыть магазин' },
  { command: 'support', description: 'Поддержка' },
];
/** Shown only in the admins' own chats. */
const ADMIN_COMMANDS = [
  ...PUBLIC_COMMANDS,
  { command: 'stats', description: 'Статистика продаж' },
  { command: 'payments', description: 'Приём оплат' },
  { command: 'promo', description: 'Промокоды' },
  { command: 'broadcast', description: 'Рассылка пользователям' },
  { command: 'balance', description: 'Баланс Install-IOS' },
  { command: 'sync', description: 'Обновить каталог' },
];

export interface BotDeps {
  webAppUrl: string;
  channelUrl: string;
  supportUrl: string;
  users: UserRepository;
  subscription: SubscriptionService;
  logger: Logger;
  /** Only these users may run admin commands; everyone else gets no answer. */
  adminIds?: readonly number[];
  /** null when the Install-IOS integration is off. */
  partnerAdmin?: Pick<PartnerAdminService, 'balanceText' | 'syncText'> | null;
  /** Admin broadcasts; absent in tests that do not need them. */
  broadcasts?: BroadcastService | null;
  /** Payments mode and promo codes (/payments, /promo). */
  shopAdmin?: ShopAdminHandlerDeps['shopAdmin'];
  /** Sales reports (/stats). */
  salesStats?: ShopAdminHandlerDeps['salesStats'];
}

export function createBot(token: string): Bot {
  return new Bot(token);
}

export function createChatMemberFetcher(bot: Bot): ChatMemberFetcher {
  return async (chatId, userId) => {
    const member = await bot.api.getChatMember(chatId, userId);
    return { status: member.status, isMember: 'is_member' in member ? member.is_member : undefined };
  };
}

/** Everything the services need from Telegram; swapped for createOfflineTelegram in TELEGRAM_OFFLINE mode. */
export interface TelegramAdapters {
  fetchMember: ChatMemberFetcher;
  fetchChannel: ChannelFetcher;
  sender: MessageSender;
  broadcast: BroadcastTelegram;
}

export function createBotTelegram(bot: Bot): TelegramAdapters {
  return {
    fetchMember: createChatMemberFetcher(bot),
    fetchChannel: createChannelFetcher(bot),
    sender: createMessageSender(bot),
    broadcast: createBroadcastTelegram(bot),
  };
}

export function createChannelFetcher(bot: Bot): ChannelFetcher {
  return async (chatId) => {
    const [chat, memberCount] = await Promise.all([bot.api.getChat(chatId), bot.api.getChatMemberCount(chatId)]);
    return { title: 'title' in chat && chat.title ? chat.title : chatId, memberCount };
  };
}

export function createMessageSender(bot: Bot): MessageSender {
  return {
    async send(chatId, html, button) {
      const keyboard = button
        ? button.webAppUrl
          ? new InlineKeyboard().webApp(button.text, button.webAppUrl)
          : new InlineKeyboard().url(button.text, button.url ?? '')
        : undefined;
      await bot.api.sendMessage(chatId, html, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
        link_preview_options: { is_disabled: true },
      });
    },
  };
}

function shopKeyboard(deps: BotDeps, startParam?: string): InlineKeyboard {
  const url = startParam ? `${deps.webAppUrl}#/orders/${encodeURIComponent(startParam)}` : deps.webAppUrl;
  return new InlineKeyboard().webApp('🛍 Открыть магазин', url).row().url('💬 Поддержка', deps.supportUrl);
}

/** Order id from `/start <id>` or from the callback data; anything else is ignored. */
function orderPayload(match: Context['match']): string | undefined {
  if (typeof match === 'string') return ORDER_PAYLOAD.test(match) ? match : undefined;
  const captured = match?.[1];
  return captured && ORDER_PAYLOAD.test(captured) ? captured : undefined;
}

export async function handleStart(ctx: Context, deps: BotDeps): Promise<void> {
  const from = ctx.from;
  if (!from || ctx.chat?.type !== 'private') return;

  await deps.users.upsert({
    id: from.id,
    firstName: from.first_name,
    lastName: from.last_name ?? null,
    username: from.username ?? null,
    photoUrl: null,
  });
  // A blocked user can only write again after unblocking the bot, which sends /start.
  await deps.users.setBotBlockedAt(from.id, null);

  const payload = orderPayload(ctx.match);
  const isSubscribed = await safeIsSubscribed(deps, from.id, true);
  if (isSubscribed === null) {
    await ctx.reply(BOT_TEXT.checkFailed);
    return;
  }
  if (!isSubscribed) {
    await replySubscribeFirst(ctx, deps, payload);
    return;
  }
  await ctx.reply(BOT_TEXT.welcome(from.first_name), { parse_mode: 'HTML', reply_markup: shopKeyboard(deps, payload) });
}

export async function handleCheckSubscription(ctx: Context, deps: BotDeps): Promise<void> {
  const isSubscribed = await safeIsSubscribed(deps, ctx.from?.id ?? 0, true);
  if (!isSubscribed) {
    await ctx.answerCallbackQuery({
      text: isSubscribed === null ? BOT_TEXT.checkFailed : BOT_TEXT.stillNotSubscribed,
      show_alert: true,
    });
    return;
  }
  await ctx.answerCallbackQuery({ text: BOT_TEXT.thanks });
  await ctx.editMessageText(BOT_TEXT.welcome(ctx.from?.first_name ?? ''), {
    parse_mode: 'HTML',
    reply_markup: shopKeyboard(deps, orderPayload(ctx.match)),
  });
}

type PartnerAdmin = NonNullable<BotDeps['partnerAdmin']>;

/** Admin-only, private chat only: others get no reply, and partner figures never land in a group. */
export async function handleAdminCommand(
  ctx: Context,
  deps: BotDeps,
  run: (admin: PartnerAdmin) => Promise<string>,
): Promise<void> {
  const userId = ctx.from?.id;
  if (userId === undefined || !deps.adminIds?.includes(userId)) return;
  if (ctx.chat?.type !== 'private') return;
  if (!deps.partnerAdmin) {
    await ctx.reply(BOT_TEXT.partnerDisabled);
    return;
  }
  try {
    await ctx.reply(await run(deps.partnerAdmin), { parse_mode: 'HTML' });
  } catch (error: unknown) {
    deps.logger.error({ err: getErrorMessage(error) }, 'Admin command failed');
    await ctx.reply(BOT_TEXT.partnerFailed);
  }
}

export function registerBotHandlers(bot: Bot, deps: BotDeps): void {
  // First, so every handler below runs only for subscribers (with the exceptions listed in the gate).
  bot.use((ctx, next) => handleSubscriptionGate(ctx, deps, next));
  bot.command('start', (ctx) => handleStart(ctx, deps));
  bot.command('support', (ctx) =>
    ctx.reply(BOT_TEXT.support, { reply_markup: new InlineKeyboard().url('💬 Написать в поддержку', deps.supportUrl) }),
  );
  bot.callbackQuery(CHECK_SUBSCRIPTION_PATTERN, (ctx) => handleCheckSubscription(ctx, deps));
  bot.command('balance', (ctx) => handleAdminCommand(ctx, deps, (admin) => admin.balanceText()));
  bot.command('sync', (ctx) => handleAdminCommand(ctx, deps, (admin) => admin.syncText()));
  registerShopAdminHandlers(bot, deps);
  registerBroadcastHandlers(bot, deps);

  bot.catch((error) => {
    const description = error.error instanceof GrammyError ? error.error.description : getErrorMessage(error.error);
    deps.logger.error({ updateId: error.ctx.update.update_id, err: description }, 'Bot handler failed');
  });
}

/** One-time setup on startup: menu button and command lists. Failures are logged, not fatal. */
export async function configureBot(bot: Bot, deps: Pick<BotDeps, 'webAppUrl' | 'logger' | 'adminIds'>): Promise<void> {
  await configureAdminCommands(bot, deps);
  try {
    await bot.api.setMyCommands(PUBLIC_COMMANDS);
    await bot.api.setChatMenuButton({
      menu_button: { type: 'web_app', text: MENU_BUTTON_TEXT, web_app: { url: deps.webAppUrl } },
    });
  } catch (error: unknown) {
    deps.logger.warn({ err: getErrorMessage(error) }, 'Bot setup failed (check BOT_TOKEN; the menu button also needs an https WEBAPP_URL)');
  }
}

async function configureAdminCommands(bot: Bot, deps: Pick<BotDeps, 'logger' | 'adminIds'>): Promise<void> {
  const adminIds = deps.adminIds ?? [];
  const results = await Promise.allSettled(
    adminIds.map((chatId) => bot.api.setMyCommands(ADMIN_COMMANDS, { scope: { type: 'chat', chat_id: chatId } })),
  );
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      deps.logger.warn(
        { adminId: adminIds[index], err: getErrorMessage(result.reason) },
        'Admin commands not set (has the admin pressed /start in the bot?)',
      );
    }
  });
}
