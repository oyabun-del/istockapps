import { GrammyError, type Bot, type Context } from 'grammy';
import { isStatsPeriod } from '../domain/stats-period.js';
import { getErrorMessage } from '../lib/app-error.js';
import type { Logger } from '../lib/logger.js';
import { isPaymentsMode } from '../services/checkout-gate.js';
import { STATS_CALLBACK_PATTERN, type SalesStatsService } from '../services/sales-stats-service.js';
import {
  PAYMENTS_CALLBACK_PATTERN,
  type AdminActor,
  type AdminView,
  type ShopAdminService,
} from '../services/shop-admin-service.js';
import { toInlineKeyboard } from './broadcast-adapter.js';

const FAILED_TEXT = 'Не получилось, подробности в логе сервера. Попробуйте ещё раз.';
/** Telegram refuses to edit a message into the very same content; that is not an error here. */
const NOT_MODIFIED = 'message is not modified';

export interface ShopAdminHandlerDeps {
  /** Only these users may run admin commands; everyone else gets no answer. */
  adminIds?: readonly number[];
  logger: Logger;
  shopAdmin?: Pick<ShopAdminService, 'paymentsView' | 'setPaymentsMode' | 'promoCommand'> | null;
  salesStats?: Pick<SalesStatsService, 'statsView'> | null;
}

/** Admins in a private chat only, like the other admin commands: shop figures never land in a group. */
function adminOf(ctx: Context, deps: ShopAdminHandlerDeps): AdminActor | null {
  const from = ctx.from;
  if (!from || ctx.chat?.type !== 'private' || !deps.adminIds?.includes(from.id)) return null;
  return { id: from.id, name: [from.first_name, from.last_name].filter(Boolean).join(' ') };
}

async function replyWith(ctx: Context, deps: ShopAdminHandlerDeps, build: () => Promise<AdminView>): Promise<void> {
  try {
    const view = await build();
    await ctx.reply(view.html, { parse_mode: 'HTML', reply_markup: toInlineKeyboard(view.keyboard) });
  } catch (error: unknown) {
    deps.logger.error({ err: getErrorMessage(error) }, 'Shop admin command failed');
    await ctx.reply(FAILED_TEXT);
  }
}

async function editWith(ctx: Context, deps: ShopAdminHandlerDeps, build: () => Promise<AdminView>): Promise<void> {
  try {
    const view = await build();
    await ctx.editMessageText(view.html, { parse_mode: 'HTML', reply_markup: toInlineKeyboard(view.keyboard) });
    await ctx.answerCallbackQuery();
  } catch (error: unknown) {
    if (error instanceof GrammyError && error.description.includes(NOT_MODIFIED)) {
      await ctx.answerCallbackQuery();
      return;
    }
    deps.logger.error({ err: getErrorMessage(error) }, 'Shop admin action failed');
    await ctx.answerCallbackQuery({ text: FAILED_TEXT, show_alert: true });
  }
}

export async function handleStatsCommand(ctx: Context, deps: ShopAdminHandlerDeps): Promise<void> {
  const stats = deps.salesStats;
  if (!adminOf(ctx, deps) || !stats) return;
  await replyWith(ctx, deps, () => stats.statsView('today'));
}

export async function handleStatsAction(ctx: Context, deps: ShopAdminHandlerDeps): Promise<void> {
  const stats = deps.salesStats;
  const period = ctx.match?.[1];
  if (!adminOf(ctx, deps) || !stats || typeof period !== 'string' || !isStatsPeriod(period)) {
    await ctx.answerCallbackQuery();
    return;
  }
  await editWith(ctx, deps, () => stats.statsView(period));
}

export async function handlePaymentsCommand(ctx: Context, deps: ShopAdminHandlerDeps): Promise<void> {
  const shopAdmin = deps.shopAdmin;
  if (!adminOf(ctx, deps) || !shopAdmin) return;
  await replyWith(ctx, deps, () => shopAdmin.paymentsView());
}

export async function handlePaymentsAction(ctx: Context, deps: ShopAdminHandlerDeps): Promise<void> {
  const shopAdmin = deps.shopAdmin;
  const actor = adminOf(ctx, deps);
  const mode = ctx.match?.[1] ?? null;
  if (!actor || !shopAdmin || typeof mode !== 'string' || !isPaymentsMode(mode)) {
    await ctx.answerCallbackQuery();
    return;
  }
  await editWith(ctx, deps, () => shopAdmin.setPaymentsMode(mode, actor));
}

export async function handlePromoCommand(ctx: Context, deps: ShopAdminHandlerDeps): Promise<void> {
  const shopAdmin = deps.shopAdmin;
  const actor = adminOf(ctx, deps);
  if (!actor || !shopAdmin) return;
  const args = typeof ctx.match === 'string' ? ctx.match : '';
  await replyWith(ctx, deps, async () => ({ html: await shopAdmin.promoCommand(args, actor) }));
}

/** Register before the broadcast handlers: their message handler takes whatever is left. */
export function registerShopAdminHandlers(bot: Bot, deps: ShopAdminHandlerDeps): void {
  bot.command('stats', (ctx) => handleStatsCommand(ctx, deps));
  bot.callbackQuery(STATS_CALLBACK_PATTERN, (ctx) => handleStatsAction(ctx, deps));
  bot.command('payments', (ctx) => handlePaymentsCommand(ctx, deps));
  bot.callbackQuery(PAYMENTS_CALLBACK_PATTERN, (ctx) => handlePaymentsAction(ctx, deps));
  bot.command('promo', (ctx) => handlePromoCommand(ctx, deps));
}
