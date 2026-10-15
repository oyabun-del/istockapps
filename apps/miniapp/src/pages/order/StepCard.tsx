import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { Icon } from '../../components/ui/Icon';
import { POP_SPRING } from '../../lib/motion';

export type StepState = 'done' | 'active' | 'locked';

type Props = {
  index: number;
  title: string;
  state: StepState;
  isLast?: boolean;
  children?: ReactNode;
};

const INDICATOR_CLASSES: Record<StepState, string> = {
  done: 'bg-success/20 text-success',
  active: 'bg-primary-container text-white shadow-[0_0_16px_-2px_rgba(37,99,235,0.55)]',
  locked: 'bg-surface-container-highest text-outline',
};

/** Numbered timeline card (design/_1 "Пошаговый процесс активации"). */
export function StepCard({ index, title, state, isLast = false, children }: Props) {
  return (
    <li
      aria-current={state === 'active' ? 'step' : undefined}
      className={`flex gap-space-md rounded-xl bg-surface-container p-space-lg transition-opacity ${
        state === 'locked' ? 'opacity-60' : ''
      }`}
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
        {state !== 'locked' && children}
      </div>
    </li>
  );
}
