import { motion } from 'motion/react';
import { NavLink } from 'react-router-dom';
import { HIGHLIGHT_SPRING } from '../../lib/motion';
import { hapticImpact } from '../../lib/telegram';
import { Icon } from '../ui/Icon';

const TABS = [
  { to: '/', label: 'Каталог', icon: 'apps', isEnd: true },
  { to: '/orders', label: 'Мои загрузки', icon: 'download_for_offline', isEnd: false },
  { to: '/guide', label: 'Инструкции', icon: 'menu_book', isEnd: true },
  { to: '/profile', label: 'Профиль', icon: 'person', isEnd: true },
] as const;

export function BottomNav() {
  return (
    <nav
      aria-label="Разделы"
      className="pb-safe fixed inset-x-0 bottom-0 z-40 bg-surface/85 shadow-[0_-2px_12px_rgba(0,0,0,0.3)] backdrop-blur-xl"
    >
      <div className="mx-auto flex h-16 max-w-xl items-center justify-around px-space-xs">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.isEnd}
            onClick={() => hapticImpact('light')}
            className={({ isActive }) =>
              `flex min-h-[44px] min-w-[64px] flex-col items-center justify-center gap-0.5 transition-colors ${
                isActive ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className="relative flex h-7 w-14 items-center justify-center">
                  {isActive && (
                    <motion.span
                      layoutId="tab-active"
                      transition={HIGHLIGHT_SPRING}
                      className="absolute inset-0 rounded-full bg-primary-container/20"
                    />
                  )}
                  <Icon name={tab.icon} isFilled={isActive} className="relative text-[24px]" />
                </span>
                <span className="text-label-sm">{tab.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
