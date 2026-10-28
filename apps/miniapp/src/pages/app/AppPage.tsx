import { BULK_DISCOUNT_TIERS, formatRub, MAX_ORDER_ITEMS, type AppDto } from '@istock/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CartBar } from '../../components/cart/CartBar';
import { Page } from '../../components/layout/Page';
import { AppIcon } from '../../components/ui/AppIcon';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { ErrorState, Skeleton } from '../../components/ui/StateViews';
import { QUICK_STEPS } from '../../content/guide';
import { useAddToCart } from '../../hooks/useCart';
import { api, errorMessage } from '../../lib/api';
import { cartStore, discountHint, discountNotice, useCartIds } from '../../lib/cart';
import { queryKeys } from '../../lib/queries';

const FIRST_TIER_ITEMS = BULK_DISCOUNT_TIERS.at(-1)?.minItems ?? 0;

function CartActions({ app }: { app: AppDto }) {
  const navigate = useNavigate();
  const cartIds = useCartIds();
  const addToCart = useAddToCart();
  const isInCart = cartIds.includes(app.id);
  const isCartFull = !isInCart && cartIds.length >= MAX_ORDER_ITEMS;
  const hint = discountHint(cartIds.length) ?? discountNotice(cartIds.length).text;

  return (
    <div className="mt-6 flex flex-col gap-2.5">
      {isInCart ? (
        <>
          <Button size="lg" isFullWidth icon="shopping_cart" onClick={() => navigate('/cart')}>
            Перейти в корзину
          </Button>
          <Button variant="ghost" isFullWidth icon="close" onClick={() => cartStore.remove(app.id)}>
            Убрать из корзины
          </Button>
        </>
      ) : (
        <Button size="lg" isFullWidth icon="add_shopping_cart" disabled={isCartFull} onClick={() => addToCart(app)}>
          В корзину за {formatRub(app.priceKopecks)}
        </Button>
      )}
      <p className="flex items-center justify-center gap-1.5 text-center text-label-md text-on-surface-variant">
        <Icon name="sell" className="text-[16px] text-secondary" />
        {isCartFull ? `В одном заказе не больше ${MAX_ORDER_ITEMS} приложений` : hint}
      </p>
    </div>
  );
}

export function AppPage() {
  const { appId = '' } = useParams();
  const app = useQuery({ queryKey: queryKeys.app(appId), queryFn: () => api.app(appId) });

  return (
    <Page subtitle="Приложение" hasBackButton hasBottomNav={false}>
      <div className="mb-4 mt-1 flex items-center justify-between">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-high px-3 py-1.5 text-body-sm text-on-surface transition-colors hover:bg-surface-bright active:scale-95"
        >
          <Icon name="arrow_back" className="text-[18px] text-primary" />В каталог
        </Link>
        <span className="text-label-sm uppercase tracking-wider text-on-surface-variant">
          Скидки от {FIRST_TIER_ITEMS} приложений
        </span>
      </div>

      {app.isPending && <Skeleton className="h-[88px]" />}
      {app.isError && <ErrorState message={errorMessage(app.error)} onRetry={() => void app.refetch()} />}

      {app.data && (
        <>
          <section className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-surface-container p-4">
            <div className="flex min-w-0 items-center gap-3.5">
              <AppIcon src={app.data.iconUrl} size="md" />
              <div className="flex min-w-0 flex-col">
                <h1 className="truncate text-headline-sm text-on-surface">{app.data.name}</h1>
                <span className="truncate text-body-sm text-on-surface-variant">{app.data.subtitle}</span>
                {app.data.minIos && <span className="text-label-sm text-outline">iOS {app.data.minIos}+</span>}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <span className="tabular block text-headline-md font-semibold text-primary">
                {formatRub(app.data.priceKopecks)}
              </span>
              <span className="text-label-sm text-on-surface-variant">разово</span>
            </div>
          </section>

          <details className="group mb-4 rounded-xl bg-surface-container p-4">
            <summary className="flex cursor-pointer list-none select-none items-center justify-between text-label-lg text-on-surface [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2">
                <Icon name="help" className="text-[20px] text-primary" />
                Как это работает
              </span>
              <Icon name="expand_more" className="text-[20px] text-on-surface-variant transition-transform group-open:rotate-180" />
            </summary>
            <ol className="mt-3 flex flex-col gap-2 border-t border-surface-container-highest/60 pt-3 text-body-sm text-on-surface-variant">
              {QUICK_STEPS.map((step, index) => (
                <li key={step} className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-label-sm text-primary">
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </details>

          <CartActions app={app.data} />
        </>
      )}
      <CartBar />
    </Page>
  );
}
