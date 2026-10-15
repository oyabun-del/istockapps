import { formatRub, type PaymentMethod } from '@istock/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Page } from '../../components/layout/Page';
import { AppIcon } from '../../components/ui/AppIcon';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { ErrorState, Skeleton } from '../../components/ui/StateViews';
import { QUICK_STEPS } from '../../content/guide';
import { api, errorMessage } from '../../lib/api';
import { queryKeys } from '../../lib/queries';
import { hapticNotify, openExternalLink } from '../../lib/telegram';
import { PaymentMethodPicker } from './PaymentMethodPicker';

export function AppPage() {
  const { appId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<PaymentMethod | null>(null);

  const app = useQuery({ queryKey: queryKeys.app(appId), queryFn: () => api.app(appId) });
  const methods = useQuery({ queryKey: queryKeys.paymentMethods, queryFn: api.paymentMethods, staleTime: 5 * 60_000 });

  const available = (methods.data ?? []).filter(
    (item) => !app.data || item.minAmountKopecks === null || app.data.priceKopecks >= item.minAmountKopecks,
  );
  // A stale choice (e.g. card below its minimum) falls back to the first available method.
  const method = available.find((item) => item.method === selected)?.method ?? available[0]?.method ?? null;

  const checkout = useMutation({
    mutationFn: (paymentMethod: PaymentMethod) => api.createOrder({ appId, paymentMethod }),
    onSuccess: (order) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.orders });
      queryClient.setQueryData(queryKeys.order(order.id), order);
      if (order.paymentUrl) openExternalLink(order.paymentUrl);
      navigate(`/orders/${order.id}`, { replace: true });
    },
    onError: () => hapticNotify('error'),
  });

  return (
    <Page subtitle="Оплата" hasBackButton hasBottomNav={false}>
      <div className="mb-4 mt-1 flex items-center justify-between">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-high px-3 py-1.5 text-body-sm text-on-surface transition-colors hover:bg-surface-bright active:scale-95"
        >
          <Icon name="arrow_back" className="text-[18px] text-primary" />В каталог
        </Link>
        <span className="text-label-sm uppercase tracking-wider text-on-surface-variant">Быстрая оплата</span>
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

          <PaymentMethodPicker
            methods={available}
            isLoading={methods.isPending}
            error={methods.isError ? errorMessage(methods.error) : null}
            selected={method}
            onSelect={setSelected}
          />

          <div className="mt-6">
            <Button
              size="lg"
              isFullWidth
              icon="lock"
              disabled={!method}
              isLoading={checkout.isPending}
              onClick={() => method && checkout.mutate(method)}
            >
              Оплатить {formatRub(app.data.priceKopecks)}
            </Button>
            {checkout.isError && (
              <p role="alert" className="mt-2.5 text-center text-body-sm text-error">
                {errorMessage(checkout.error)}
              </p>
            )}
            <p className="mt-2.5 flex items-center justify-center gap-1 text-label-sm text-on-surface-variant">
              <Icon name="verified_user" className="text-[13px] text-secondary" />
              Безопасный платёж через CISPAY
            </p>
          </div>
        </>
      )}
    </Page>
  );
}
