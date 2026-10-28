import { formatRub } from '@istock/shared';
import { Link } from 'react-router-dom';
import { AppIcon } from '../../components/ui/AppIcon';
import { Icon } from '../../components/ui/Icon';
import type { CartLine } from '../../hooks/useCart';

type Props = {
  line: CartLine;
  onRemove: (appId: string) => void;
};

export function CartItemRow({ line, onRemove }: Props) {
  const { app, pricing } = line;
  const hasDiscount = pricing.discountKopecks > 0;
  return (
    <div className="flex items-center gap-3 rounded-xl bg-surface-container p-3 pr-2">
      <Link to={`/apps/${encodeURIComponent(app.id)}`} className="flex min-w-0 flex-1 items-center gap-3">
        <AppIcon src={app.iconUrl} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-headline-sm text-on-surface">{app.name}</span>
          <span className="truncate text-body-sm text-on-surface-variant">{app.subtitle}</span>
        </span>
      </Link>
      <span className="flex shrink-0 flex-col items-end leading-tight">
        {hasDiscount && <s className="tabular text-label-sm text-outline">{formatRub(pricing.priceKopecks)}</s>}
        <span className={`tabular text-label-lg font-bold ${hasDiscount ? 'text-success' : 'text-on-surface'}`}>
          {formatRub(pricing.totalKopecks)}
        </span>
      </span>
      <button
        type="button"
        aria-label={`Убрать ${app.name} из корзины`}
        onClick={() => onRemove(app.id)}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-all hover:bg-surface-container-high hover:text-on-surface active:scale-90"
      >
        <Icon name="close" className="text-[20px]" />
      </button>
    </div>
  );
}
