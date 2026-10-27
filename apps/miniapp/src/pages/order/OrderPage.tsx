import { formatRub, isPaidStatus, type OrderDto } from '@istock/shared';
import { useCallback, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Page } from '../../components/layout/Page';
import { AppIcon } from '../../components/ui/AppIcon';
import { Badge } from '../../components/ui/Badge';
import { Icon } from '../../components/ui/Icon';
import { ErrorState, Skeleton } from '../../components/ui/StateViews';
import { errorMessage } from '../../lib/api';
import { formatOrderDate } from '../../lib/format';
import { ORDER_STATUS_META } from '../../lib/order-status';
import { useMe, useOrder } from '../../lib/queries';
import { openTelegramLink } from '../../lib/telegram';
import { AwaitingPayment } from './AwaitingPayment';
import { DeliverySteps } from './DeliverySteps';
import { PaymentClosed, isClosedStatus } from './PaymentClosed';

function OrderHeader({ order }: { order: OrderDto }) {
  const meta = ORDER_STATUS_META[order.status];
  return (
    <section className="flex items-center gap-space-md rounded-xl bg-surface-container-high p-space-lg shadow-md">
      <AppIcon src={order.app.iconUrl} size="md" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h1 className="truncate text-headline-md tracking-tight text-on-surface">{order.app.name}</h1>
        <span className="tabular text-body-sm text-on-surface-variant">
          Заказ #{order.id}, {formatOrderDate(order.createdAt).toLowerCase()}
        </span>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="tabular text-headline-sm text-on-surface">{formatRub(order.amountKopecks)}</span>
        {order.status !== 'awaiting_payment' && <Badge label={meta.label} tone={meta.tone} icon={meta.icon} />}
      </div>
    </section>
  );
}

function SupportRow() {
  const { data: me } = useMe();
  return (
    <section className="flex items-center gap-space-md rounded-xl bg-surface-container p-space-md">
      <Icon name="support_agent" className="text-[24px] text-tertiary" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-label-lg text-on-surface">Возникла трудность?</span>
        <span className="text-body-sm text-on-surface-variant">Поддержка ответит в Telegram</span>
      </div>
      {me && (
        <button
          type="button"
          onClick={() => openTelegramLink(me.supportUrl)}
          className="flex h-9 shrink-0 items-center gap-1 rounded-full bg-tertiary-container/30 px-3.5 text-label-lg text-tertiary transition-transform active:scale-[0.97]"
        >
          Написать
          <Icon name="chevron_right" className="text-[18px]" />
        </button>
      )}
    </section>
  );
}

export function OrderPage() {
  const { orderId } = useParams();
  const id = Number(orderId);
  const order = useOrder(id);
  const [isChecking, setIsChecking] = useState(false);
  const { refetch } = order;

  // Only a refresh the buyer asked for shows a spinner; background polling stays silent.
  const checkStatus = useCallback(async () => {
    setIsChecking(true);
    try {
      await refetch();
    } finally {
      setIsChecking(false);
    }
  }, [refetch]);
  const handleRefresh = useCallback(() => void checkStatus(), [checkStatus]);

  const data = order.data;
  const closedStatus = data && isClosedStatus(data.status) ? data.status : null;

  return (
    <Page subtitle="Заказ" hasBackButton>
      <div className="flex flex-col gap-space-lg">
        {order.isPending && (
          <>
            <Skeleton className="h-[88px]" />
            <Skeleton className="h-[260px]" />
          </>
        )}
        {order.isError && <ErrorState message={errorMessage(order.error)} onRetry={handleRefresh} />}

        {data && closedStatus && <PaymentClosed order={data} status={closedStatus} />}
        {data && !closedStatus && (
          <>
            <OrderHeader order={data} />
            {data.status === 'awaiting_payment' && (
              <AwaitingPayment order={data} isRefreshing={isChecking} onRefresh={handleRefresh} />
            )}
            {isPaidStatus(data.status) && <DeliverySteps order={data} />}
            <SupportRow />
          </>
        )}
      </div>
    </Page>
  );
}
