import type { Transition } from 'motion/react';

/** Exponential ease-out: fast start, long soft landing. */
export const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

/** Route content entrance. Short so navigation never feels slower. */
export const PAGE_TRANSITION: Transition = { duration: 0.32, ease: EASE_OUT_EXPO };

/** Sliding selection highlights (chips, tabs, payment methods). */
export const HIGHLIGHT_SPRING: Transition = { type: 'spring', stiffness: 520, damping: 40, mass: 0.8 };

/** Small confirmations (step checkmark). */
export const POP_SPRING: Transition = { type: 'spring', stiffness: 600, damping: 22 };

/** Content revealed by a user action (credentials, login code). */
export const REVEAL = {
  initial: { opacity: 0, y: 8, filter: 'blur(4px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, y: -4, filter: 'blur(2px)' },
  transition: { duration: 0.36, ease: EASE_OUT_EXPO },
} as const;

export const LIST_STAGGER_S = 0.045;
