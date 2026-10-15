import { useMe } from '../lib/queries';
import { openTelegramLink } from '../lib/telegram';
import { Icon } from './ui/Icon';

type Props = {
  label?: string;
  /** Secondary when another action on the screen is the primary one. */
  isSecondary?: boolean;
};

const PRIMARY = 'bg-tertiary-container text-white shadow-lg shadow-tertiary-container/25';
const SECONDARY = 'bg-surface-container-high text-on-surface';

export function SupportButton({ label = 'Написать в поддержку', isSecondary = false }: Props) {
  const { data: me } = useMe();
  if (!me) return null;

  return (
    <button
      type="button"
      onClick={() => openTelegramLink(me.supportUrl)}
      className={`flex h-12 w-full items-center justify-center gap-2 rounded-full text-label-lg transition-transform active:scale-[0.97] ${isSecondary ? SECONDARY : PRIMARY}`}
    >
      <Icon name="support_agent" className="text-[20px]" />
      {label}
    </button>
  );
}
