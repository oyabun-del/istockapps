import {
  ACTIVE_PAYMENT_METHOD,
  BULK_DISCOUNT_TIERS,
  exceedsOrderLimit,
  formatRub,
  MAX_ORDER_TOTAL_KOPECKS,
  type CartPricing,
  type ErrorCode,
  type PromoCheckDto,
} from '@istock/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Page } from '../../components/layout/Page';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/StateViews';
import { LEGAL_PATHS } from '../../content/legal';
import { useCart } from '../../hooks/useCart';
import { ApiError, api, errorMessage } from '../../lib/api';
import { cartStore } from '../../lib/cart';
import { queryKeys } from '../../lib/queries';
import { hapticNotify, openExternalLink } from '../../lib/telegram';
import { CartItemRow } from './CartItemRow';
import { DiscountProgress } from './DiscountProgress';
import { PromoCodeField } from './PromoCodeField';
import { SbpPaymentRow } from './SbpPaymentRow';

const PAYMENT_METHODS_STALE_MS = 5 * 60_000;
/** Admins switch payments on and off from the bot; a cart left open should notice soon. */
const CHECKOUT_STALE_MS = 30_000;
/** The shop's payment rules changed under the buyer: reload them before the next attempt. */
const CHECKOUT_RULE_ERRORS: readonly ErrorCode[] = ['PAYMENTS_CLOSED', 'PROMO_INVALID', 'PROMO_LIMIT_REACHED'];
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

function CartSummary({ pricing, isFree }: { pricing: CartPricing; isFree: boolean }) {
  return (
    <dl aria-label="Итог" className="flex flex-col gap-2 rounded-xl bg-surface-container p-4">
      {(pricing.discountKopecks > 0 || isFree) && (
        <SummaryRow label="Стоимость">{formatRub(pricing.subtotalKopecks)}</SummaryRow>
      )}
      {pricing.discountKopecks > 0 && (
        <SummaryRow label="Скидка">
          <span className="text-success">−{formatRub(pricing.discountKopecks)}</span>
        </SummaryRow>
      )}
      {isFree && (
        <SummaryRow label="По промокоду">
          <span className="text-success">−{formatRub(pricing.totalKopecks)}</span>
        </SummaryRow>
      )}
      <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-white/5 pt-3">
        <dt className="text-label-lg text-on-surface">Итого</dt>
        <dd className="tabular text-headline-md font-semibold text-on-surface">
          {isFree ? 'Бесплатно' : formatRub(pricing.totalKopecks)}
        </dd>
      </div>
    </dl>
  );
}

function FreePaymentRow() {
  return (
    <section aria-labelledby="payment-heading">
      <h2 id="payment-heading" className="mb-2.5 px-1 text-label-lg text-on-surface">
        Способ оплаты
      </h2>
      <div className="flex items-center gap-3 rounded-xl bg-surface-container p-3.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-success/10">
          <Icon name="sell" className="text-[22px] text-success" />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-label-lg text-on-surface">Промокод</span>
          <span className="text-body-sm text-on-surface-variant">Платить не нужно: заказ покрывает промокод</span>
        </div>
      </div>
    </section>
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

function PaymentsClosedNotice() {
  return (
    <p role="status" className="flex items-start gap-2 rounded-xl bg-warning/10 p-3.5 text-body-sm text-warning">
      <Icon name="schedule" className="mt-0.5 shrink-0 text-[18px]" />
      Приём оплат временно приостановлен. Корзина сохранится — загляните чуть позже.
    </p>
  );
}

function OrderLimitNotice() {
  return (
    <p role="status" className="flex items-start gap-2 rounded-xl bg-warning/10 p-3.5 text-body-sm text-warning">
      <Icon name="warning" className="mt-0.5 shrink-0 text-[18px]" />
      Максимальная сумма заказа — {formatRub(MAX_ORDER_TOTAL_KOPECKS)}. Уберите часть приложений из корзины.
    </p>
  );
}

type CheckoutVariables = { appIds: string[]; totalKopecks: number; promoCode?: string };

function useCheckout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ appIds, totalKopecks, promoCode }: CheckoutVariables) =>
      api.createOrder({
        appIds,
        paymentMethod: ACTIVE_PAYMENT_METHOD,
        expectedTotalKopecks: totalKopecks,
        ...(promoCode ? { promoCode } : {}),
      }),
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
      if (error instanceof ApiError && CHECKOUT_RULE_ERRORS.includes(error.code as ErrorCode)) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.checkout });
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
  const rules = useQuery({ queryKey: queryKeys.checkout, queryFn: api.checkout, staleTime: CHECKOUT_STALE_MS });
  const [promo, setPromo] = useState<PromoCheckDto | null>(null);
  const isSbpAvailable = methods.data?.some((item) => item.method === ACTIVE_PAYMENT_METHOD) ?? false;
  const { pricing } = cart;
  const isEmpty = cart.ids.length === 0;
  // Unknown mode (request failed): let the buyer try, the server has the final word.
  const paymentsMode = rules.data?.paymentsMode ?? 'open';
  const isPromoOnly = paymentsMode === 'promo';
  // A free code pays for the cart itself: no invoice, so SBP does not have to be available.
  const isFree = paymentsMode !== 'closed' && promo?.isFree === true;
  // Too many apps for an access code only warns: the buyer's own open invoice for this cart is handed out again.
  // A free order has no invoice to reuse, so a cart the code cannot cover is refused here.
  const isFreeOverLimit = isFree && pricing !== null && pricing.itemCount > (promo?.appsLeft ?? 0);
  const isPromoMissing = isPromoOnly && !promo;
  const isOverLimit = pricing !== null && exceedsOrderLimit(pricing.totalKopecks);
  const canPay = isFree
    ? !isFreeOverLimit && !isOverLimit
    : isSbpAvailable && paymentsMode !== 'closed' && !isPromoMissing && !isOverLimit;
  const actionLabel = isFree ? 'Получить бесплатно' : 'Оплатить';

  const pay = () => {
    if (!pricing) return;
    const promoCode = isPromoOnly || isFree ? promo?.code : undefined;
    checkout.mutate({ appIds: [...cart.ids], totalKopecks: pricing.totalKopecks, promoCode });
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
          <CartSummary pricing={pricing} isFree={isFree} />
          {isOverLimit && <OrderLimitNotice />}

          {paymentsMode === 'closed' && <PaymentsClosedNotice />}
          {paymentsMode !== 'closed' && isFree && <FreePaymentRow />}
          {paymentsMode !== 'closed' && !isFree && (
            <SbpPaymentRow
              isAvailable={isSbpAvailable}
              isLoading={methods.isPending}
              error={methods.isError ? errorMessage(methods.error) : null}
            />
          )}
          {paymentsMode !== 'closed' && (
            <PromoCodeField
              mode={paymentsMode}
              applied={promo}
              itemCount={pricing.itemCount}
              onApply={setPromo}
              onClear={() => setPromo(null)}
            />
          )}

          <div className="mt-2">
            <Button
              size="lg"
              isFullWidth
              icon={isFree ? 'sell' : 'lock'}
              disabled={!canPay}
              isLoading={checkout.isPending}
              onClick={pay}
            >
              {isFree ? actionLabel : `${actionLabel} ${formatRub(pricing.totalKopecks)}`}
            </Button>
            {checkout.isError && (
              <p role="alert" className="mt-2.5 text-center text-body-sm text-error">
                {checkoutError}
              </p>
            )}
            {!isFree && (
              <p className="mt-2.5 flex items-center justify-center gap-1 text-label-sm text-on-surface-variant">
                <Icon name="verified_user" className="text-[13px] text-secondary" />
                Безопасный платёж через Platega
              </p>
            )}
            <p className="mt-1.5 text-balance text-center text-label-sm text-outline">
              Нажимая «{actionLabel}», вы принимаете{' '}
              <Link to={LEGAL_PATHS.terms} className="underline underline-offset-2 hover:text-primary">
                условия соглашения
              </Link>{' '}
              и{' '}
              <Link to={LEGAL_PATHS.privacy} className="underline underline-offset-2 hover:text-primary">
                политику конфиденциальности
              </Link>
            </p>
          </div>
        </div>
      )}
    </Page>
  );
}
