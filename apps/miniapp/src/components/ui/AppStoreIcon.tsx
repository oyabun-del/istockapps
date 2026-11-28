import { useId } from 'react';

type Props = {
  className?: string;
};

/**
 * Simplified App Store glyph (blue rounded square, white "A" of three strokes), as iOS shows it next
 * to the Settings item where App Store sign-in lives. Sized by the surrounding text; decorative.
 */
export function AppStoreIcon({ className = '' }: Props) {
  // useId() contains characters such as ":" that break a url(#…) reference.
  const fillId = `app-store-icon-${useId().replace(/[^\w-]/g, '')}`;
  return (
    <svg
      aria-hidden="true"
      data-testid="app-store-icon"
      viewBox="0 0 24 24"
      className={`inline-block h-[1.15em] w-[1.15em] shrink-0 ${className}`}
    >
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1ac8fc" />
          <stop offset="1" stopColor="#1d6ff2" />
        </linearGradient>
      </defs>
      <rect width="24" height="24" rx="5.4" fill={`url(#${fillId})`} />
      <g stroke="#fff" strokeWidth="1.9" strokeLinecap="round" fill="none">
        <path d="M7.4 17.4 13 7.6" />
        <path d="M11 7.6l5.6 9.8" />
        <path d="M6.2 14.6h11.6" />
      </g>
    </svg>
  );
}
