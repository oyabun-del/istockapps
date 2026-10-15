import { useState } from 'react';
import { Icon } from './Icon';

type Size = 'sm' | 'md' | 'lg';

type Props = {
  src: string;
  size?: Size;
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'h-11 w-11 rounded-xl',
  md: 'h-14 w-14 rounded-2xl',
  lg: 'h-16 w-16 rounded-[18px]',
};

const SIZE_PX: Record<Size, number> = { sm: 44, md: 56, lg: 64 };

/** iOS-style squircle app icon with a graceful fallback when the image fails. */
export function AppIcon({ src, size = 'sm' }: Props) {
  const [hasFailed, setHasFailed] = useState(false);
  const classes = `${SIZE_CLASSES[size]} shrink-0 overflow-hidden bg-surface-container-lowest shadow-sm ring-1 ring-white/5`;

  if (hasFailed || !src) {
    return (
      <div className={`${classes} flex items-center justify-center text-outline`} aria-hidden="true">
        <Icon name="apps" className="text-[24px]" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      width={SIZE_PX[size]}
      height={SIZE_PX[size]}
      loading="lazy"
      onError={() => setHasFailed(true)}
      className={`${classes} object-cover`}
    />
  );
}
