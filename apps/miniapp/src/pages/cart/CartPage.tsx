import { ACTIVE_PAYMENT_METHOD, BULK_DISCOUNT_TIERS, formatRub, type CartPricing } from '@istock/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Page } from '../../components/layout/Page';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/StateViews';
import { useCart } from '../../hooks/useCart';
import { ApiError, api, errorMessage } from '../../lib/api';
import { cartStore } from '../../lib/cart';
import { queryKeys } from '../../lib/queries';
import { hapticNotify, openExternalLink } from '../../lib/telegram';
import { CartItemRow } from './CartItemRow';
import { DiscountProgress } from './DiscountProgress';
import { SbpPaymentRow } from './SbpPaymentRow';

const PAYMENT_METHODS_STALE_MS = 5 * 60_000;
const EMPTY_CART_TEXT = BULK_DISCOUNT_TIERS.map(
  (tier) => `от ${tier.minItems} приложений — скидка ${formatRub(tier.perItemKopecks)} на каждое`,
)
  .reverse()
  .join(', ');

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-body-md text-on-surface-variant">{label}</dt>
      <dd className="tabular text-body-md text-on-surface">{children}</dd>
    </div>
  );
}

function CartSummary({ pricing }: { pricing: CartPricing }) {
  return (
    <dl aria-label="Итог" className="flex flex-col gap-2 rounded-xl bg-surface-container p-4">
      {pricing.discountKopecks > 0 && (
        <>
          <SummaryRow label="Стоимость">{formatRub(pricing.subtotalKopecks)}</SummaryRow>
          <SummaryRow label="Скидка">
            <span className="text-success">−{formatRub(pricing.discountKopecks)}</span>
          </SummaryRow>
        </>
      )}
      <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-white/5 pt-3">
        <dt className="text-label-lg text-on-surface">Итого</dt>
        <dd className="tabular text-headline-md font-semibold text-on-surface">{formatRub(pricing.totalKopecks)}</dd>
      </div>
    </dl>
  );
}

function EmptyCart() {
  return (
    <EmptyState
      icon="shopping_cart"
      title="Корзина пуста"
      text={`Добавьте приложения из каталога: ${EMPTY_CART_TEXT}.`}
      action={
        <Link to="/" className="text-label-lg text-primary">
          Перейти в каталог
        </Link>
      }
    />
  );
}

function useCheckout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ appIds, totalKopecks }: { appIds: string[]; totalKopecks: number }) =>
      api.createOrder({ appIds, paymentMethod: ACTIVE_PAYMENT_METHOD, expectedTotalKopecks: totalKopecks }),
    onSuccess: (order) => {
      cartStore.clear();
      void queryClient.invalidateQueries({ queryKey: queryKeys.orders });
      queryClient.setQueryData(queryKeys.order(order.id), order);
      if (order.paymentUrl) openExternalLink(order.paymentUrl);
      navigate(`/orders/${order.id}`, { replace: true });
    },
    onError: (error) => {
      hapticNotify('error');
      // Prices moved since the cart was filled: show the fresh ones before the next attempt.
      if (error instanceof ApiError && (error.code === 'PRICE_CHANGED' || error.code === 'NOT_FOUND')) {
        void queryClient.invalidateQueries({ queryKey: ['app'] });
      }
    },
  });
}

function isPriceChanged(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'PRICE_CHANGED';
}

export function CartPage() {
  const cart = useCart();
  const checkout = useCheckout();
  const { reset } = checkout;
  const methods = useQuery({
    queryKey: queryKeys.paymentMethods,
    queryFn: api.paymentMethods,
    staleTime: PAYMENT_METHODS_STALE_MS,
  });
  const isSbpAvailable = methods.data?.some((item) => item.method === ACTIVE_PAYMENT_METHOD) ?? false;
  const { pricing } = cart;
  const isEmpty = cart.ids.length === 0;

  const pay = () => {
    if (pricing) checkout.mutate({ appIds: [...cart.ids], totalKopecks: pricing.totalKopecks });
  };

  // An error about the previous set of apps no longer applies once the buyer changes the cart.
  const cartKey = cart.ids.join(',');
  useEffect(() => reset(), [cartKey, reset]);

  // After PRICE_CHANGED the cart re-reads prices; name the new total once it differs.
  const attemptedKopecks = checkout.variables?.totalKopecks;
  const checkoutError =
    isPriceChanged(checkout.error) && pricing && attemptedKopecks !== undefined && pricing.totalKopecks !== attemptedKopecks
      ? `Цена изменилась: теперь ${formatRub(pricing.totalKopecks)}. Проверьте и оплатите ещё раз.`
      : errorMessage(checkout.error);

  return (
    <Page subtitle="Корзина" hasBackButton hasBottomNav={false}>
      <h1 className="mb-4 mt-1 text-headline-md tracking-tight text-on-surface">Корзина</h1>

      {cart.hasDroppedApps && (
        <p role="status" className="mb-4 flex items-start gap-1.5 rounded-lg bg-warning/10 p-space-sm text-body-sm text-warning">
          <Icon name="warning" className="mt-0.5 text-[16px]" />
          Некоторые приложения больше недоступны и убраны из корзины
        </p>
      )}
      {isEmpty && <EmptyCart />}
      {!isEmpty && cart.isLoading && !pricing && (
        <div className="flex flex-col gap-3">
          {cart.ids.map((id) => (
            <Skeleton key={id} className="h-[70px]" />
          ))}
        </div>
      )}
      {!isEmpty && cart.error !== null && !pricing && (
        <ErrorState message={errorMessage(cart.error)} onRetry={cart.refetch} />
      )}

      {pricing && pricing.itemCount > 0 && (
        <div className="flex flex-col gap-4">
          <ul aria-label="Приложения в корзине" className="flex flex-col gap-2.5">
            <AnimatePresence initial={false}>
              {cart.lines.map((line) => (
                <motion.li key={line.app.id} layout exit={{ opacity: 0, x: -24, transition: { duration: 0.18 } }}>
                  <CartItemRow line={line} onRemove={cartStore.remove} />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>

          <DiscountProgress itemCount={pricing.itemCount} />
          <CartSummary pricing={pricing} />

          <SbpPaymentRow
            isAvailable={isSbpAvailable}
            isLoading={methods.isPending}
            error={methods.isError ? errorMessage(methods.error) : null}
          />

          <div className="mt-2">
            <Button
              size="lg"
              isFullWidth
              icon="lock"
              disabled={!isSbpAvailable}
              isLoading={checkout.isPending}
              onClick={pay}
            >
              Оплатить {formatRub(pricing.totalKopecks)}
            </Button>
            {checkout.isError && (
              <p role="alert" className="mt-2.5 text-center text-body-sm text-error">
                {checkoutError}
              </p>
            )}
            <p className="mt-2.5 flex items-center justify-center gap-1 text-label-sm text-on-surface-variant">
              <Icon name="verified_user" className="text-[13px] text-secondary" />
              Безопасный платёж через CISPAY
            </p>
          </div>
        </div>
      )}
    </Page>
  );
}
