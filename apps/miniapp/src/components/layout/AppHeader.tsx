import { Link } from 'react-router-dom';
import logoUrl from '../../assets/logo.svg';
import { getTelegramProfile } from '../../lib/telegram';
import { Icon } from '../ui/Icon';

type Props = {
  subtitle: string;
};

function Avatar() {
  const profile = getTelegramProfile();
  if (profile?.photoUrl) {
    return <img src={profile.photoUrl} alt="" width={32} height={32} className="h-8 w-8 rounded-full object-cover" />;
  }
  const initial = profile?.firstName.charAt(0).toUpperCase() ?? '';
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-container-high text-label-lg text-primary">
      {initial || <Icon name="person" className="text-[18px]" />}
    </span>
  );
}

export function AppHeader({ subtitle }: Props) {
  return (
    <header className="pt-safe fixed inset-x-0 top-0 z-40 bg-surface/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-xl items-center justify-between px-margin">
        <Link to="/" className="flex items-center gap-2.5" aria-label="iStockApps, каталог">
          <img
            src={logoUrl}
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 rounded-lg shadow-[0_0_16px_-2px_rgba(59,130,246,0.55)]"
          />
          <span className="flex flex-col">
            <span className="text-headline-sm leading-tight text-on-surface">iStockApps</span>
            <span className="text-label-sm font-medium leading-none text-on-surface-variant">{subtitle}</span>
          </span>
        </Link>
        <Link
          to="/profile"
          className="flex h-11 w-11 items-center justify-center rounded-full transition-opacity hover:opacity-80"
          aria-label="Профиль"
        >
          <Avatar />
        </Link>
      </div>
    </header>
  );
}
