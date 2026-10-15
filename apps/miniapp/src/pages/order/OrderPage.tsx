import { isPaidStatus, type OrderDto } from '@istock/shared';
import { Link, useParams } from 'react-router-dom';
import { Page } from '../../components/layout/Page';
import { SupportButton } from '../../components/SupportButton';
import { AppIcon } from '../../components/ui/AppIcon';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { ErrorState, Skeleton } from '../../components/ui/StateViews';
import { errorMessage } from '../../lib/api';
import { ORDER_STATUS_META } from '../../lib/order-status';
import { useOrder } from '../../lib/queries';
import { openExternalLink } from '../../lib/telegram';
import { DeliverySteps } from './DeliverySteps';

function OrderHeader({ order }: { order: OrderDto }) {
  const meta = ORDER_STATUS_META[order.status];
  return (
    <section className="rounded-xl bg-surface-container-high p-space-lg shadow-md">
      <div className="flex items-center justify-between gap-2">
        <Badge label={`Заказ #${order.id} · ${meta.label}`} tone={meta.tone} icon={meta.icon} />
      </div>
      <div className="flex items-center gap-space-md pt-space-md">
        <AppIcon src={order.app.iconUrl} size="md" />
        <h1 className="min-w-0 truncate text-headline-lg tracking-tight text-on-surface">{order.app.name}</h1>
      </div>
    </section>
  );
}

function AwaitingPayment({ order }: { order: OrderDto }) {
  return (
    <section className="flex flex-col gap-space-md rounded-xl bg-surface-container p-space-lg">
      <div className="flex items-center gap-space-sm">
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warning opacity-60" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-warning" />
        </span>
        <h2 className="text-headline-sm text-on-surface">Ждём оплату</h2>
      </div>
      <p className="text-body-sm text-on-surface-variant">
        Завершите оплату на странице CISPAY. Статус обновится автоматически, страницу можно не закрывать.
      </p>
      {order.paymentUrl && (
        <Button isFullWidth icon="open_in_new" onClick={() => openExternalLink(order.paymentUrl as string)}>
          Перейти к оплате
        </Button>
      )}
    </section>
  );
}

function PaymentProblem({ order }: { order: OrderDto }) {
  const isRefunded = order.status === 'refunded';
  return (
    <section className="flex flex-col gap-space-md rounded-xl bg-surface-container p-space-lg">
      <h2 className="text-headline-sm text-on-surface">{isRefunded ? 'Деньги возвращены' : 'Оплата не завершена'}</h2>
      <p className="text-body-sm text-on-surface-variant">
        {isRefunded
          ? 'По этому заказу оформлен возврат. Если это ошибка, напишите в поддержку.'
          : 'Счёт отменён или истёк. Деньги не списаны, можно оформить заказ заново.'}
      </p>
      {!isRefunded && (
        <Link
          to={`/apps/${encodeURIComponent(order.app.id)}`}
          className="flex h-11 items-center justify-center gap-2 rounded-full bg-primary-container text-label-lg text-white"
        >
          <Icon name="refresh" className="text-[20px]" />
          Оформить заново
        </Link>
      )}
    </section>
  );
}

export function OrderPage() {
  const { orderId } = useParams();
  const id = Number(orderId);
  const order = useOrder(id);

  return (
    <Page subtitle="Заказ" hasBackButton>
      <div className="flex flex-col gap-space-lg">
        {order.isPending && <Skeleton className="h-[120px]" />}
        {order.isError && <ErrorState message={errorMessage(order.error)} onRetry={() => void order.refetch()} />}

        {order.data && (
          <>
            <OrderHeader order={order.data} />
            {order.data.status === 'awaiting_payment' && <AwaitingPayment order={order.data} />}
            {isPaidStatus(order.data.status) && <DeliverySteps order={order.data} />}
            {['failed', 'expired', 'refunded'].includes(order.data.status) && <PaymentProblem order={order.data} />}
            <Link
              to={`/support?order=${order.data.id}`}
              className="flex items-center justify-center gap-1.5 text-label-lg text-primary"
            >
              <Icon name="report" className="text-[18px]" />
              Проблема с заказом? Создать обращение
            </Link>
            <SupportButton />
          </>
        )}
      </div>
    </Page>
  );
}
