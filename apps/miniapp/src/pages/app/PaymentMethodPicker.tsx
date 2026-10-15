import type { PaymentMethod, PaymentMethodDto } from '@istock/shared';
import { motion } from 'motion/react';
import { Icon } from '../../components/ui/Icon';
import { Skeleton } from '../../components/ui/StateViews';
import { HIGHLIGHT_SPRING } from '../../lib/motion';
import { PAYMENT_METHOD_META } from '../../lib/order-status';
import { hapticImpact } from '../../lib/telegram';

type Props = {
  methods: PaymentMethodDto[];
  isLoading: boolean;
  error: string | null;
  selected: PaymentMethod | null;
  onSelect: (method: PaymentMethod) => void;
};

export function PaymentMethodPicker({ methods, isLoading, error, selected, onSelect }: Props) {
  return (
    <fieldset>
      <legend className="mb-2.5 flex w-full items-center justify-between px-1">
        <span className="text-label-lg text-on-surface">Способ оплаты</span>
      </legend>

      {isLoading && <Skeleton className="h-[76px]" />}
      {error && <p className="text-body-sm text-error">{error}</p>}
      {!isLoading && !error && methods.length === 0 && (
        <p className="text-body-sm text-on-surface-variant">Оплата временно недоступна. Попробуйте позже.</p>
      )}

      <div className="grid grid-cols-3 gap-2">
        {methods.map(({ method }) => {
          const meta = PAYMENT_METHOD_META[method];
          const isActive = method === selected;
          return (
            <button
              key={method}
              type="button"
              aria-pressed={isActive}
              onClick={() => {
                hapticImpact('light');
                onSelect(method);
              }}
              className={`relative flex flex-col items-center justify-center gap-1.5 rounded-xl bg-surface-container p-3 transition-[color,transform] duration-200 active:scale-95 ${
                isActive ? 'text-on-surface' : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="payment-active"
                  transition={HIGHLIGHT_SPRING}
                  className="absolute inset-0 rounded-xl bg-surface-container-high ring-1 ring-inset ring-primary/50"
                />
              )}
              <Icon name={meta.icon} className={`relative text-[22px] ${meta.iconClass}`} />
              <span className="relative text-label-md">{meta.label}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
