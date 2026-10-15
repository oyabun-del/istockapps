import { formatRub, type OrderDto } from '@istock/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Page } from '../../components/layout/Page';
import { AppIcon } from '../../components/ui/AppIcon';
import { Badge } from '../../components/ui/Badge';
import { Icon } from '../../components/ui/Icon';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/StateViews';
import { api, errorMessage } from '../../lib/api';
import { ORDER_STATUS_META } from '../../lib/order-status';
import { queryKeys } from '../../lib/queries';

const DATE_FORMAT = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });

function OrderRow({ order }: { order: OrderDto }) {
  const meta = ORDER_STATUS_META[order.status];
  return (
    <Link
      to={`/orders/${order.id}`}
      className="flex items-center gap-3 rounded-xl bg-surface-container p-3.5 transition-all hover:bg-surface-container-high active:scale-[0.99]"
    >
      <AppIcon src={order.app.iconUrl} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-headline-sm text-on-surface">{order.app.name}</span>
        <span className="tabular text-body-sm text-on-surface-variant">
          #{order.id} · {DATE_FORMAT.format(new Date(order.createdAt))} · {formatRub(order.amountKopecks)}
        </span>
        <span>
          <Badge label={meta.label} tone={meta.tone} icon={meta.icon} />
        </span>
      </div>
      <Icon name="chevron_right" className="text-[20px] text-outline" />
    </Link>
  );
}

export function DownloadsPage() {
  const orders = useQuery({ queryKey: queryKeys.orders, queryFn: api.orders });

  return (
    <Page subtitle="Мои загрузки">
      <h1 className="mb-space-md mt-space-xs text-headline-md tracking-tight text-on-surface">Мои загрузки</h1>
      <div className="flex flex-col gap-space-md">
        {orders.isPending && [0, 1, 2].map((key) => <Skeleton key={key} className="h-[92px]" />)}
        {orders.isError && <ErrorState message={errorMessage(orders.error)} onRetry={() => void orders.refetch()} />}
        {orders.data?.length === 0 && (
          <EmptyState
            icon="download_for_offline"
            title="Покупок пока нет"
            text="Выберите приложение в каталоге. После оплаты оно появится здесь."
            action={
              <Link to="/" className="text-label-lg text-primary">
                Перейти в каталог
              </Link>
            }
          />
        )}
        {orders.data?.map((order) => <OrderRow key={order.id} order={order} />)}
      </div>
    </Page>
  );
}
