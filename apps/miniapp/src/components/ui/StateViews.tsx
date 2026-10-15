import type { ReactNode } from 'react';
import type { IconName } from '../../lib/icons';
import { Button } from './Button';
import { Icon } from './Icon';

type ErrorProps = {
  message: string;
  onRetry?: () => void;
};

export function ErrorState({ message, onRetry }: ErrorProps) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-xl bg-surface-container px-6 py-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-error-container/40 text-error">
        <Icon name="error" className="text-[26px]" />
      </span>
      <p className="text-body-md text-on-surface-variant">{message}</p>
      {onRetry && (
        <Button variant="secondary" icon="refresh" onClick={onRetry}>
          Повторить
        </Button>
      )}
    </div>
  );
}

type EmptyProps = {
  icon: IconName;
  title: string;
  text: string;
  action?: ReactNode;
};

export function EmptyState({ icon, title, text, action }: EmptyProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl bg-surface-container px-6 py-10 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-container-high text-primary">
        <Icon name={icon} className="text-[28px]" />
      </span>
      <h2 className="text-headline-sm text-on-surface">{title}</h2>
      <p className="max-w-[260px] text-body-sm text-on-surface-variant">{text}</p>
      {action}
    </div>
  );
}

type SkeletonProps = {
  className?: string;
};

export function Skeleton({ className = '' }: SkeletonProps) {
  return (
    <div className={`relative overflow-hidden rounded-xl bg-surface-container ${className}`} aria-hidden="true">
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/[0.04] to-transparent" />
    </div>
  );
}

export function FullScreenLoader() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center text-primary">
      <span className="sr-only">Загрузка…</span>
      <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-current border-r-transparent" />
    </div>
  );
}
