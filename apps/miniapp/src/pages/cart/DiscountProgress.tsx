import { BULK_DISCOUNT_TIERS, formatRub } from '@istock/shared';
import { motion } from 'motion/react';
import { Icon } from '../../components/ui/Icon';
import { discountHint } from '../../lib/cart';
import { EASE_OUT_EXPO } from '../../lib/motion';

/** Lowest tier first, the way the buyer climbs them. */
const TIERS = [...BULK_DISCOUNT_TIERS].reverse();
const TOP_TIER_ITEMS = BULK_DISCOUNT_TIERS[0]?.minItems ?? 1;

type Props = {
  itemCount: number;
};

/** Shows both tiers, how far the cart is, and how many apps are left to the next discount. */
export function DiscountProgress({ itemCount }: Props) {
  const hint = discountHint(itemCount);
  const progress = Math.min(itemCount / TOP_TIER_ITEMS, 1);
  return (
    <section aria-labelledby="discount-heading" className="rounded-xl bg-surface-container p-4">
      <h2 id="discount-heading" className="flex items-center gap-2 text-label-lg text-on-surface">
        <Icon name="sell" className="text-[20px] text-secondary" />
        Скидка за количество
      </h2>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-container-highest" aria-hidden="true">
        <motion.div
          className="h-full rounded-full bg-success"
          initial={false}
          animate={{ width: `${progress * 100}%` }}
          transition={{ duration: 0.5, ease: EASE_OUT_EXPO }}
        />
      </div>

      <ul className="mt-3 grid grid-cols-2 gap-2">
        {TIERS.map((tier) => {
          const isReached = itemCount >= tier.minItems;
          return (
            <li
              key={tier.minItems}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-label-md transition-colors ${
                isReached ? 'bg-success/15 text-success' : 'bg-surface-container-high text-on-surface-variant'
              }`}
            >
              <Icon name={isReached ? 'check_circle' : 'sell'} className="text-[18px]" />
              <span>
                от {tier.minItems}: <span className="tabular font-semibold">−{formatRub(tier.perItemKopecks)}</span> за каждое
              </span>
            </li>
          );
        })}
      </ul>

      <p role="status" className="mt-3 text-body-sm text-on-surface-variant">
        {hint ?? 'Максимальная скидка применена'}
      </p>
    </section>
  );
}
