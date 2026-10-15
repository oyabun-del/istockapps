import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { IconName } from '../../lib/icons';
import { Icon } from './Icon';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'md' | 'lg';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  isLoading?: boolean;
  isFullWidth?: boolean;
};

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    'bg-primary-container text-on-primary shadow-lg shadow-primary-container/25 hover:bg-[#2f6bf0] disabled:shadow-none',
  secondary: 'bg-surface-container-high text-on-surface hover:bg-surface-bright',
  ghost: 'bg-transparent text-primary hover:bg-surface-container-high',
};

const SIZE_CLASSES: Record<Size, string> = {
  md: 'h-11 px-5 text-label-lg',
  lg: 'h-12 px-6 text-label-lg',
};

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  isLoading = false,
  isFullWidth = false,
  disabled,
  className = '',
  type = 'button',
  ...rest
}: Props) {
  const isDisabled = disabled || isLoading;
  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={isLoading || undefined}
      className={[
        'inline-flex select-none items-center justify-center gap-2 rounded-full font-semibold transition-all',
        'active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        isFullWidth ? 'w-full' : '',
        className,
      ].join(' ')}
      {...rest}
    >
      {isLoading ? <Spinner className="h-5 w-5" /> : icon && <Icon name={icon} className="text-[20px]" />}
      <span>{children}</span>
    </button>
  );
}
