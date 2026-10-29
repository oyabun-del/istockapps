import { randomInt } from 'node:crypto';
import { formatAppCount, normalizePromoCode, PROMO_CODE_PATTERN, type PaymentsMode } from '@istock/shared';
import type { InlineButton, Keyboard, PromoCode } from '../domain/models.js';
import { DEFAULT_PROMO_MAX_APPS, PROMO_MAX_APPS_LIMIT, promoHoldSince } from '../domain/promo.js';
import { escapeHtml } from '../lib/html.js';
import type { Repositories } from '../repositories/repositories.js';
import { PAYMENTS_MODE_LABELS, type CheckoutGate } from './checkout-gate.js';

export const PAYMENTS_CALLBACK_PREFIX = 'payments:';
export const PAYMENTS_CALLBACK_PATTERN = /^payments:(open|promo|closed)$/;

/** No 0/O or 1/I: a generated code is often read out or retyped. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const GENERATED_CODE_LENGTH = 8;
const GENERATE_ATTEMPTS = 3;
const POSITIVE_INT = /^\d+$/;

const MODE_BUTTONS: Record<PaymentsMode, string> = {
  open: '🟢 Открыть для всех',
  promo: '🟡 Только по промокоду',
  closed: '🔴 Закрыть',
};
const MODE_ORDER: readonly PaymentsMode[] = ['open', 'promo', 'closed'];

const PROMO_HELP = [
  '<b>Команды</b>',
  `/promo add [КОД] [N] — создать код на N приложений (по умолчанию случайный код на ${DEFAULT_PROMO_MAX_APPS})`,
  '/promo off КОД — выключить код',
].join('\n');

export interface AdminView {
  html: string;
  keyboard?: Keyboard;
}

/** Who did it, for the other admins: "Иван (id 123)". */
export interface AdminActor {
  id: number;
  name: string;
}

export interface ShopAdminDeps {
  checkout: Pick<CheckoutGate, 'getMode' | 'setMode' | 'isOpenModeAllowed'>;
  repos: Pick<Repositories, 'promoCodes' | 'orders'>;
  /** Tells the other admins about a change; failures are handled by the notifier. */
  notifyAdmins: (html: string, exceptId: number) => Promise<unknown>;
  now?: () => Date;
}

function generateCode(): string {
  return Array.from({ length: GENERATED_CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
}

function parseMaxApps(raw: string | undefined): number | null {
  if (raw === undefined) return DEFAULT_PROMO_MAX_APPS;
  if (!POSITIVE_INT.test(raw)) return null;
  const value = Number(raw);
  return value >= 1 && value <= PROMO_MAX_APPS_LIMIT ? value : null;
}

/** Payments mode and promo codes for shop admins, answered as Telegram HTML. */
export class ShopAdminService {
  private readonly now: () => Date;

  constructor(private readonly deps: ShopAdminDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async paymentsView(): Promise<AdminView> {
    const mode = await this.deps.checkout.getMode();
    const { isOpenModeAllowed } = this.deps.checkout;
    const options = MODE_ORDER.filter((option) => option !== 'open' || isOpenModeAllowed);
    const keyboard = options.map((option): InlineButton[] => [
      {
        kind: 'callback',
        text: option === mode ? `✅ ${MODE_BUTTONS[option]}` : MODE_BUTTONS[option],
        data: `${PAYMENTS_CALLBACK_PREFIX}${option}`,
      },
    ]);
    const html = [
      '💳 <b>Приём оплат</b>',
      `Сейчас: <b>${PAYMENTS_MODE_LABELS[mode]}</b>`,
      '',
      'Режим влияет только на новые заказы: уже выставленные счета принимаются всегда.',
      isOpenModeAllowed ? null : '🧪 Оплаты тестовые (PAYMENT_PROVIDER=mock): приложения выдаются только по промокоду.',
      'Промокоды: /promo',
    ]
      .filter((line): line is string => line !== null)
      .join('\n');
    return { html, keyboard };
  }

  /** Switches the mode and tells the other admins; returns the refreshed view. */
  async setPaymentsMode(mode: PaymentsMode, actor: AdminActor): Promise<AdminView> {
    const previous = await this.deps.checkout.getMode();
    // A button from an older message may still offer "open" while payments are fake.
    const isAllowed = mode !== 'open' || this.deps.checkout.isOpenModeAllowed;
    if (isAllowed && previous !== mode) {
      await this.deps.checkout.setMode(mode);
      await this.deps.notifyAdmins(
        `💳 ${escapeHtml(actor.name)} (id <code>${actor.id}</code>) переключил приём оплат: <b>${PAYMENTS_MODE_LABELS[mode]}</b>`,
        actor.id,
      );
    }
    return this.paymentsView();
  }

  /** `/promo <args>`: list, add or turn off codes. */
  async promoCommand(args: string, actor: AdminActor): Promise<string> {
    const [action = '', ...rest] = args.trim().split(/\s+/).filter(Boolean);
    switch (action.toLowerCase()) {
      case '':
      case 'list':
        return this.promoList();
      case 'add':
        return this.addPromo(rest, actor);
      case 'off':
        return this.disablePromo(rest[0]);
      default:
        return `Не понял команду.\n\n${PROMO_HELP}`;
    }
  }

  private async promoList(): Promise<string> {
    const codes = await this.deps.repos.promoCodes.list();
    const holdSince = promoHoldSince(this.now());
    const lines = await Promise.all(
      codes.map(async (promo) => {
        const used = await this.deps.repos.orders.countPromoApps(promo.id, holdSince);
        const state = promo.disabledAt ? ', выключен' : '';
        return `<code>${promo.code}</code> — ${used}/${promo.maxApps}${state}`;
      }),
    );
    const mode = await this.deps.checkout.getMode();
    return [
      '🎟 <b>Промокоды</b>',
      lines.length > 0 ? lines.join('\n') : 'Промокодов пока нет.',
      '',
      `Приём оплат: ${PAYMENTS_MODE_LABELS[mode]} (/payments)`,
      '',
      PROMO_HELP,
    ].join('\n');
  }

  private async addPromo(args: readonly string[], actor: AdminActor): Promise<string> {
    // "/promo add 3" is a random code for 3 apps; "/promo add CODE [N]" names the code.
    const [first, second] = args;
    const isCountOnly = first !== undefined && second === undefined && POSITIVE_INT.test(first);
    const rawCode = isCountOnly ? undefined : first;
    const maxApps = parseMaxApps(isCountOnly ? first : second);
    if (maxApps === null) return `Число приложений — от 1 до ${PROMO_MAX_APPS_LIMIT}.`;

    const created =
      rawCode === undefined
        ? await this.createGenerated(maxApps, actor)
        : await this.createNamed(rawCode, maxApps, actor);
    if (typeof created === 'string') return created;

    const mode = await this.deps.checkout.getMode();
    const hint =
      mode === 'promo' ? '' : '\n\nКод заработает, когда приём оплат будет «только по промокоду»: /payments';
    return `✅ Промокод <code>${created.code}</code> на ${formatAppCount(created.maxApps)} создан.${hint}`;
  }

  private async createNamed(rawCode: string, maxApps: number, actor: AdminActor): Promise<PromoCode | string> {
    const code = normalizePromoCode(rawCode);
    if (!PROMO_CODE_PATTERN.test(code)) return 'Код — от 6 до 32 латинских букв, цифр, «_» или «-».';
    const created = await this.deps.repos.promoCodes.create({ code, maxApps, createdBy: actor.id });
    return created ?? `Промокод <code>${code}</code> уже есть.`;
  }

  private async createGenerated(maxApps: number, actor: AdminActor): Promise<PromoCode | string> {
    for (let attempt = 0; attempt < GENERATE_ATTEMPTS; attempt += 1) {
      const created = await this.deps.repos.promoCodes.create({ code: generateCode(), maxApps, createdBy: actor.id });
      if (created) return created;
    }
    return 'Не удалось подобрать свободный код, попробуйте ещё раз.';
  }

  private async disablePromo(rawCode: string | undefined): Promise<string> {
    if (!rawCode) return 'Укажите код: /promo off КОД';
    const code = normalizePromoCode(rawCode);
    const promo = PROMO_CODE_PATTERN.test(code) ? await this.deps.repos.promoCodes.disable(code, this.now()) : null;
    if (!promo) return `Промокода <code>${escapeHtml(code)}</code> нет.`;
    return `Промокод <code>${promo.code}</code> выключен. Уже выставленные по нему счета ещё можно оплатить.`;
  }
}
