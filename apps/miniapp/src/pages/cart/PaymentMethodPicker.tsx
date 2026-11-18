import { CARD_MIN_KOPECKS, formatRub, type ActivePaymentMethod } from '@istock/shared';
import { Icon } from '../../components/ui/Icon';
import { Skeleton } from '../../components/ui/StateViews';
import { PAYMENT_METHOD_META } from '../../lib/order-status';

type Props = {
  /** Methods enabled at the providers, in the order the shop shows them. */
  methods: readonly ActivePaymentMethod[];
  selected: ActivePaymentMethod | null;
  onSelect: (method: ActivePaymentMethod) => void;
  totalKopecks: number;
  isLoading: boolean;
  error: string | null;
};

const HINTS: Record<ActivePaymentMethod, string> = {
  SBP: 'Оплата в приложении вашего банка',
  CARD: 'Visa, Mastercard, МИР',
};

/** Why a method cannot pay this cart, or null when it can. */
export function methodBlocker(method: ActivePaymentMethod, totalKopecks: number): string | null {
  if (method === 'CARD' && totalKopecks < CARD_MIN_KOPECKS) return `Картой — от ${formatRub(CARD_MIN_KOPECKS)}`;
  return null;
}

export function PaymentMethodPicker({ methods, selected, onSelect, totalKopecks, isLoading, error }: Props) {
  return (
    <section aria-labelledby="payment-heading">
      <h2 id="payment-heading" className="mb-2.5 px-1 text-label-lg text-on-surface">
        Способ оплаты
      </h2>
      {isLoading && <Skeleton className="h-[64px]" />}
      {error && <p className="text-body-sm text-error">{error}</p>}
      {!isLoading && !error && methods.length === 0 && (
        <p className="text-body-sm text-on-surface-variant">Оплата временно недоступна. Попробуйте позже.</p>
      )}
      {methods.length > 0 && (
        <div role="radiogroup" aria-labelledby="payment-heading" className="flex flex-col gap-2">
          {methods.map((method) => {
            const meta = PAYMENT_METHOD_META[method];
            const blocker = methodBlocker(method, totalKopecks);
            const isSelected = selected === method;
            return (
              <button
                key={method}
                type="button"
                role="radio"
                aria-checked={isSelected}
                disabled={blocker !== null}
                onClick={() => onSelect(method)}
                className={`flex min-h-[64px] items-center gap-3 rounded-xl border p-3.5 text-left transition-colors disabled:opacity-50 ${
                  isSelected ? 'border-primary bg-surface-container-high' : 'border-transparent bg-surface-container'
                }`}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-container-high">
                  <Icon name={meta.icon} className={`text-[22px] ${meta.iconClass}`} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-label-lg text-on-surface">{meta.label}</span>
                  <span className="text-body-sm text-on-surface-variant">{blocker ?? HINTS[method]}</span>
                </span>
                {methods.length > 1 && (
                  <Icon
                    name={isSelected ? 'radio_button_checked' : 'radio_button_unchecked'}
                    className={`shrink-0 text-[22px] ${isSelected ? 'text-primary' : 'text-outline'}`}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
