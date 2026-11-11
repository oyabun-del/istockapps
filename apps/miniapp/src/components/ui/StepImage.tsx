import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GuideImage } from '../../content/guide';
import { EASE_OUT_EXPO } from '../../lib/motion';
import { Icon } from './Icon';

/** Intrinsic size of the schematics in assets/guide: reserves the space before they load. */
const WIDTH = 320;
const HEIGHT = 360;

const FADE = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.2, ease: EASE_OUT_EXPO },
} as const;

type Props = {
  image: GuideImage;
};

/** Screen schematic of a step; a tap opens it full screen, where the small labels are readable. */
export function StepImage({ image }: Props) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isOpen]);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label="Увеличить схему"
        className="relative mx-auto block w-full max-w-[280px] overflow-hidden rounded-2xl ring-1 ring-outline-variant/60 transition-transform active:scale-[0.98]"
      >
        <img src={image.src} alt={image.alt} width={WIDTH} height={HEIGHT} loading="lazy" decoding="async" className="block h-auto w-full" />
        <span className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-surface/80 text-on-surface backdrop-blur">
          <Icon name="zoom_in" className="text-[18px]" />
        </span>
      </button>

      {/* Portal: page transitions transform the ancestors, which would trap a fixed overlay. */}
      {createPortal(
        <AnimatePresence>
          {isOpen && (
            <motion.div
              {...FADE}
              role="dialog"
              aria-modal="true"
              aria-label={image.alt}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-margin"
            >
              <img src={image.src} alt="" width={WIDTH} height={HEIGHT} className="h-auto max-h-full w-full max-w-md" />
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Закрыть"
                className="absolute right-margin top-margin flex h-10 w-10 items-center justify-center rounded-full bg-surface-container-high text-on-surface"
              >
                <Icon name="close" className="text-[22px]" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
