import { formatRub } from '@istock/shared';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useCart } from '../../hooks/useCart';
import { discountNotice, formatAppCount, type DiscountNotice } from '../../lib/cart';
import { EASE_OUT_EXPO, POP_SPRING } from '../../lib/motion';
import { Icon } from '../ui/Icon';

/** How long the "add N more" / "discount applied" notice stays after an app is added. */
export const CART_NOTICE_MS = 3200;

const SAFE_BOTTOM = 'var(--tg-safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))';
/** Bottom navigation is h-16 (4rem). */
const ABOVE_NAV = `calc(4rem + ${SAFE_BOTTOM} + 0.5rem)`;
const ABOVE_EDGE = `calc(${SAFE_BOTTOM} + 0.75rem)`;

type Props = {
  /** The page shows the bottom navigation, so the bar floats above it. */
  hasBottomNav?: boolean;
};

/** Pops a notice each time the cart grows; cleared after a while or when the cart shrinks. */
function useGrowthNotice(count: number): DiscountNotice | null {
  const previous = useRef(count);
  const [notice, setNotice] = useState<DiscountNotice | null>(null);

  useEffect(() => {
    const hasGrown = count > previous.current;
    previous.current = count;
    if (!hasGrown) {
      setNotice(null);
      return;
    }
    setNotice(discountNotice(count));
    const timer = setTimeout(() => setNotice(null), CART_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [count]);

  return notice;
}

function Notice({ notice }: { notice: DiscountNotice }) {
  const tone = notice.isReached ? 'bg-success text-surface' : 'bg-surface-container-highest text-on-surface';
  return (
    <motion.p
      key={notice.text}
      initial={{ opacity: 0, y: 10, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, transition: { duration: 0.16 } }}
      transition={POP_SPRING}
      className={`mb-2 flex items-center gap-2 rounded-2xl px-4 py-2.5 text-label-lg shadow-lg ${tone}`}
    >
      <Icon name={notice.isReached ? 'sell' : 'add_shopping_cart'} className="text-[20px]" />
      {notice.text}
    </motion.p>
  );
}

/** Floating cart summary with the bulk discount; hidden while the cart is empty. */
export function CartBar({ hasBottomNav = false }: Props) {
  const cart = useCart();
  const count = cart.ids.length;
  const notice = useGrowthNotice(count);
  if (count === 0) return null;

  const pricing = cart.pricing;
  const hasDiscount = (pricing?.discountKopecks ?? 0) > 0;
  const caption = hasDiscount && pricing ? `${formatAppCount(count)}, скидка ${formatRub(pricing.discountKopecks)}` : formatAppCount(count);

  const bar = (
    <div className="fixed inset-x-0 z-30 px-margin" style={{ bottom: hasBottomNav ? ABOVE_NAV : ABOVE_EDGE }}>
      <div className="mx-auto max-w-xl">
        <div role="status" aria-live="polite">
          <AnimatePresence mode="popLayout">{notice && <Notice key={notice.text} notice={notice} />}</AnimatePresence>
        </div>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.36, ease: EASE_OUT_EXPO }}
        >
          <Link
            to="/cart"
            aria-label={`Корзина: ${caption}`}
            className="flex items-center justify-between gap-3 rounded-2xl bg-primary-container px-4 py-3 text-on-primary shadow-lg shadow-primary-container/30 transition-transform active:scale-[0.98]"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15">
                <Icon name="shopping_cart" isFilled className="text-[20px]" />
                <motion.span
                  key={count}
                  initial={{ scale: 0.5 }}
                  animate={{ scale: 1 }}
                  transition={POP_SPRING}
                  className="tabular absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-surface px-1 text-[11px] font-bold text-primary"
                >
                  {count}
                </motion.span>
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-label-lg">Корзина</span>
                <span className="truncate text-label-sm opacity-80">{caption}</span>
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {pricing && hasDiscount && <s className="tabular text-label-sm opacity-60">{formatRub(pricing.subtotalKopecks)}</s>}
              {pricing && <span className="tabular text-headline-sm font-semibold">{formatRub(pricing.totalKopecks)}</span>}
              <Icon name="chevron_right" className="text-[20px]" />
            </span>
          </Link>
        </motion.div>
      </div>
    </div>
  );

  return (
    <>
      {/* Keeps the last rows of the page reachable above the floating bar. */}
      <div aria-hidden="true" className="h-20 shrink-0" />
      {createPortal(bar, document.body)}
    </>
  );
}
