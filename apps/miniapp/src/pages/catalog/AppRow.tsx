import { formatRub, type AppDto } from '@istock/shared';
import { Link } from 'react-router-dom';
import { AppIcon } from '../../components/ui/AppIcon';
import { Icon } from '../../components/ui/Icon';
import { hapticImpact } from '../../lib/telegram';

type Props = {
  app: AppDto;
};

export function AppRow({ app }: Props) {
  return (
    <Link
      to={`/apps/${encodeURIComponent(app.id)}`}
      onClick={() => hapticImpact('light')}
      className="group flex items-center justify-between gap-3 rounded-xl bg-surface-container p-3.5 transition-all hover:bg-surface-container-high active:scale-[0.99]"
    >
      <div className="flex min-w-0 items-center gap-3.5">
        <AppIcon src={app.iconUrl} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-headline-sm text-on-surface">{app.name}</span>
          <span className="truncate text-body-sm text-on-surface-variant">{app.subtitle}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span className="tabular text-label-lg font-bold text-secondary">{formatRub(app.priceKopecks)}</span>
        <Icon name="chevron_right" className="text-[20px] text-outline transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}
