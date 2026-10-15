import type { CategoryDto } from '@istock/shared';
import { motion } from 'motion/react';
import { Icon } from '../../components/ui/Icon';
import { HIGHLIGHT_SPRING } from '../../lib/motion';
import { hapticImpact } from '../../lib/telegram';

type Props = {
  categories: CategoryDto[];
  activeId: string;
  onSelect: (id: string) => void;
};

export function CategoryChips({ categories, activeId, onSelect }: Props) {
  if (categories.length === 0) return <div className="h-[30px]" aria-hidden="true" />;

  return (
    <div role="tablist" aria-label="Категории" className="-mx-margin flex items-center gap-space-xs overflow-x-auto px-margin pb-1">
      {categories.map((category) => {
        const isActive = category.id === activeId;
        return (
          <button
            key={category.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => {
              hapticImpact('light');
              onSelect(category.id);
            }}
            className={`relative flex shrink-0 items-center gap-1.5 rounded-full bg-surface-container-high px-3.5 py-1.5 text-label-md transition-[color,transform] duration-200 active:scale-95 ${
              isActive ? 'text-on-primary-container' : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {isActive && (
              <motion.span
                layoutId="category-active"
                transition={HIGHLIGHT_SPRING}
                className="absolute inset-0 rounded-full bg-primary-container shadow-sm"
              />
            )}
            <Icon name={category.icon} className="relative text-[16px]" />
            <span className="relative">{category.title}</span>
          </button>
        );
      })}
    </div>
  );
}
