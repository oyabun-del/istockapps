import type { IconName } from '../../lib/icons';
import type { Tone } from '../../lib/order-status';
import { Icon } from './Icon';

type Props = {
  label: string;
  tone?: Tone;
  icon?: IconName;
};

const TONE_CLASSES: Record<Tone, string> = {
  info: 'bg-secondary-container/15 text-secondary ring-secondary/30',
  success: 'bg-success/15 text-success ring-success/30',
  warning: 'bg-warning/15 text-warning ring-warning/30',
  danger: 'bg-error-container/40 text-error ring-error/30',
  neutral: 'bg-surface-container-highest text-on-surface-variant ring-white/5',
};

export function Badge({ label, tone = 'info', icon }: Props) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-label-md ring-1 ring-inset ${TONE_CLASSES[tone]}`}
    >
      {icon && <Icon name={icon} className="text-[14px]" />}
      {label}
    </span>
  );
}
