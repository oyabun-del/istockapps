import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { useBackButton } from '../../hooks/useBackButton';
import { PAGE_TRANSITION } from '../../lib/motion';
import { AppHeader } from './AppHeader';
import { BottomNav } from './BottomNav';

type Props = {
  subtitle: string;
  children: ReactNode;
  /** Nested pages show Telegram's back button; tab pages show the bottom navigation. */
  hasBackButton?: boolean;
  hasBottomNav?: boolean;
};

function BackButtonBinder() {
  useBackButton();
  return null;
}

export function Page({ subtitle, children, hasBackButton = false, hasBottomNav = true }: Props) {
  return (
    <>
      {hasBackButton && <BackButtonBinder />}
      <AppHeader subtitle={subtitle} />
      <motion.main
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={PAGE_TRANSITION}
        className={`mx-auto flex min-h-[100dvh] w-full max-w-xl flex-col px-margin pt-[calc(3.5rem+var(--tg-content-safe-area-inset-top,0px)+0.5rem)] ${
          hasBottomNav ? 'pb-28' : 'pb-10'
        }`}
      >
        {children}
      </motion.main>
      {hasBottomNav && <BottomNav />}
    </>
  );
}
