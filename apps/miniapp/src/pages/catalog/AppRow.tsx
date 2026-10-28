import { formatRub, priceItem, type AppDto } from '@istock/shared';
import { Link } from 'react-router-dom';
import { AppIcon } from '../../components/ui/AppIcon';
import { Icon } from '../../components/ui/Icon';
import { hapticImpact } from '../../lib/telegram';

type Props = {
  app: AppDto;
  isInCart: boolean;
  /** Discount the cart's tier gives each app; shown only on apps in the cart. */
  discountPerItemKopecks: number;
  onToggleCart: (app: AppDto) => void;
};

function Price({ app, isInCart, discountPerItemKopecks }: Omit<Props, 'onToggleCart'>) {
  const { discountKopecks, totalKopecks } = priceItem(app.priceKopecks, isInCart ? discountPerItemKopecks : 0);
  if (discountKopecks === 0) {
    return <span className="tabular text-label-lg font-bold text-secondary">{formatRub(app.priceKopecks)}</span>;
  }
  return (
    <span className="flex flex-col items-end leading-tight">
      <s className="tabular text-label-sm text-outline">{formatRub(app.priceKopecks)}</s>
      <span className="tabular text-label-lg font-bold text-success">{formatRub(totalKopecks)}</span>
    </span>
  );
}

export function AppRow({ app, isInCart, discountPerItemKopecks, onToggleCart }: Props) {
  const cartLabel = isInCart ? `Убрать ${app.name} из корзины` : `Добавить ${app.name} в корзину`;
  return (
    <div className="flex items-center gap-2 rounded-xl bg-surface-container p-3.5 pr-2.5 transition-colors hover:bg-surface-container-high">
      <Link
        to={`/apps/${encodeURIComponent(app.id)}`}
        onClick={() => hapticImpact('light')}
        className="group flex min-w-0 flex-1 items-center justify-between gap-3 active:scale-[0.99]"
      >
        <div className="flex min-w-0 items-center gap-3.5">
          <AppIcon src={app.iconUrl} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-headline-sm text-on-surface">{app.name}</span>
            <span className="truncate text-body-sm text-on-surface-variant">{app.subtitle}</span>
          </div>
        </div>
        <Price app={app} isInCart={isInCart} discountPerItemKopecks={discountPerItemKopecks} />
      </Link>
      <button
        type="button"
        aria-label={cartLabel}
        aria-pressed={isInCart}
        onClick={() => onToggleCart(app)}
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all active:scale-90 ${
          isInCart ? 'bg-primary-container text-on-primary' : 'bg-surface-container-high text-primary hover:bg-surface-bright'
        }`}
      >
        <Icon name={isInCart ? 'check' : 'add_shopping_cart'} className="text-[22px]" />
      </button>
    </div>
  );
}
