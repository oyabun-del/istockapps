import {
  formatAppCount,
  normalizePromoCode,
  PAYMENTS_MODES,
  PROMO_CODE_PATTERN,
  type PaymentsMode,
} from '@istock/shared';
import type { PromoCode } from '../domain/models.js';
import { promoHoldSince } from '../domain/promo.js';
import { AppError } from '../lib/app-error.js';
import type { Repositories } from '../repositories/repositories.js';

export const PAYMENTS_MODE_KEY = 'payments.mode';
/** Nothing saved yet: the shop takes payments as it did before the switch existed. */
const DEFAULT_PAYMENTS_MODE: PaymentsMode = 'open';

/** How each mode reads in admin messages: "Приём оплат: открыт для всех". */
export const PAYMENTS_MODE_LABELS: Record<PaymentsMode, string> = {
  open: '🟢 открыт для всех',
  promo: '🟡 только по промокоду',
  closed: '🔴 закрыт',
};

export function isPaymentsMode(value: string | null): value is PaymentsMode {
  return value !== null && (PAYMENTS_MODES as readonly string[]).includes(value);
}

export interface PromoAccess {
  promo: PromoCode;
  appsLeft: number;
}

export function promoLimitError(appsLeft: number): AppError {
  return new AppError(
    'PROMO_LIMIT_REACHED',
    appsLeft === 0
      ? 'Промокод уже использован полностью'
      : `По промокоду можно оплатить ещё ${formatAppCount(appsLeft)}. Уберите лишние из корзины.`,
  );
}

export interface CheckoutGateDeps {
  repos: Pick<Repositories, 'settings' | 'promoCodes' | 'orders'>;
  now?: () => Date;
}

/** Decides who may open a new invoice: the payments mode switched from the bot, and promo codes. */
export class CheckoutGate {
  private readonly now: () => Date;

  constructor(private readonly deps: CheckoutGateDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async getMode(): Promise<PaymentsMode> {
    const saved = await this.deps.repos.settings.get(PAYMENTS_MODE_KEY);
    return isPaymentsMode(saved) ? saved : DEFAULT_PAYMENTS_MODE;
  }

  async setMode(mode: PaymentsMode): Promise<void> {
    await this.deps.repos.settings.set(PAYMENTS_MODE_KEY, mode);
  }

  /** The code and how many apps it still covers; PROMO_INVALID for unknown, disabled or malformed codes. */
  async checkPromo(rawCode: string): Promise<PromoAccess> {
    const code = normalizePromoCode(rawCode);
    const promo = PROMO_CODE_PATTERN.test(code) ? await this.deps.repos.promoCodes.findByCode(code) : null;
    if (!promo || promo.disabledAt) {
      throw new AppError('PROMO_INVALID', 'Промокод не найден или больше не действует');
    }
    const used = await this.deps.repos.orders.countPromoApps(promo.id, promoHoldSince(this.now()));
    return { promo, appsLeft: Math.max(0, promo.maxApps - used) };
  }

  /**
   * Lets a checkout through, or throws. Returns the promo code it goes through, if any. The code's
   * app limit is not checked here: the buyer's own open invoice for the same apps may be handed out
   * again without taking more, and a new order is checked atomically by OrderRepository.createWithinPromo.
   */
  async authorize(promoCode: string | undefined): Promise<PromoCode | null> {
    const mode = await this.getMode();
    if (mode === 'open') return null;
    if (mode === 'closed') {
      throw new AppError('PAYMENTS_CLOSED', 'Приём оплат временно приостановлен. Попробуйте позже.');
    }
    if (!promoCode) throw new AppError('PAYMENTS_CLOSED', 'Сейчас оплата доступна только по промокоду');
    return (await this.checkPromo(promoCode)).promo;
  }
}
