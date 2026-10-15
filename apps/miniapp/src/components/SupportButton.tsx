import { useMe } from '../lib/queries';
import { openTelegramLink } from '../lib/telegram';
import { Icon } from './ui/Icon';

type Props = {
  label?: string;
};

export function SupportButton({ label = 'Написать в поддержку Telegram 24/7' }: Props) {
  const { data: me } = useMe();
  if (!me) return null;

  return (
    <button
      type="button"
      onClick={() => openTelegramLink(me.supportUrl)}
      className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-tertiary-container text-label-lg text-white shadow-lg shadow-tertiary-container/25 transition-transform active:scale-[0.97]"
    >
      <Icon name="support_agent" className="text-[20px]" />
      {label}
    </button>
  );
}
