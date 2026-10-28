import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from '../../components/ui/Icon';
import { POP_SPRING, REVEAL } from '../../lib/motion';

/** Locked steps are not rendered at all, so a card is either the current step or a finished one. */
export type StepState = 'done' | 'active';

type Props = {
  index: number;
  title: string;
  state: StepState;
  isLast?: boolean;
  /** Opened while the buyer is on the page: animate it in and scroll it into view. */
  isNew?: boolean;
  children?: ReactNode;
};

const INDICATOR_CLASSES: Record<StepState, string> = {
  done: 'bg-success/20 text-success',
  active: 'bg-primary-container text-white shadow-[0_0_16px_-2px_rgba(37,99,235,0.55)]',
};

/** Numbered timeline card (design/_1 "Пошаговый процесс активации"). */
export function StepCard({ index, title, state, isLast = false, isNew = false, children }: Props) {
  const ref = useRef<HTMLLIElement>(null);

  useEffect(() => {
    // Older WebViews and jsdom have no scrollIntoView.
    if (isNew) ref.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }, [isNew]);

  return (
    <motion.li
      ref={ref}
      {...(isNew ? REVEAL : {})}
      aria-current={state === 'active' ? 'step' : undefined}
      className="flex gap-space-md rounded-xl bg-surface-container p-space-lg"
    >
      <div className="flex flex-col items-center">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-label-md font-bold transition-colors duration-300 ${INDICATOR_CLASSES[state]}`}
        >
          <AnimatePresence mode="wait" initial={false}>
            {state === 'done' ? (
              <motion.span
                key="done"
                className="flex"
                initial={{ scale: 0.4, opacity: 0, rotate: -30 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                transition={POP_SPRING}
              >
                <Icon name="check" className="text-[18px]" />
              </motion.span>
            ) : (
              <motion.span key="index" exit={{ scale: 0.6, opacity: 0, transition: { duration: 0.12 } }}>
                {index}
              </motion.span>
            )}
          </AnimatePresence>
        </span>
        {!isLast && <span className="my-space-xs w-0.5 grow rounded-full bg-surface-container-highest" />}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-space-sm pb-space-xs">
        <h3 className="text-balance text-headline-sm text-on-surface">{title}</h3>
        {children}
      </div>
    </motion.li>
  );
}
