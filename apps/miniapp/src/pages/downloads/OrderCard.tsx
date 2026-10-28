import { formatRub, type OrderDto } from '@istock/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AppIconStack } from '../../components/ui/AppIconStack';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { useReorder } from '../../hooks/useReorder';
import { useSecondsUntil } from '../../hooks/useSecondsUntil';
import { formatCountdown, formatOrderDate, formatOrderTitle } from '../../lib/format';
import type { IconName } from '../../lib/icons';
import { ORDER_STATUS_META, type Tone } from '../../lib/order-status';
import { openExternalLink } from '../../lib/telegram';

const DOT_CLASSES: Record<Tone, string> = {
  info: 'bg-secondary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-error',
  neutral: 'bg-outline',
};

const TEXT_CLASSES: Record<Tone, string> = {
  info: 'text-secondary',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-error',
  neutral: 'text-on-surface-variant',
};

const ACTION_BASE = 'flex h-11 items-center justify-center gap-2 rounded-full text-label-lg transition-transform active:scale-[0.97]';
const PRIMARY_LINK = `${ACTION_BASE} bg-primary-container text-on-primary shadow-lg shadow-primary-container/25`;
const SECONDARY_LINK = `${ACTION_BASE} bg-surface-container-high text-on-surface`;

function ActionLink({ to, icon, isPrimary = false, children }: { to: string; icon: IconName; isPrimary?: boolean; children: ReactNode }) {
  return (
    <Link to={to} className={isPrimary ? PRIMARY_LINK : SECONDARY_LINK}>
      <Icon name={icon} className="text-[20px]" />
      {children}
    </Link>
  );
}

function TimeLeft({ expiresAt }: { expiresAt: string }) {
  const seconds = useSecondsUntil(expiresAt);
  if (seconds === 0) return null;
  return <span className="tabular">, осталось {formatCountdown(seconds)}</span>;
}

function ReorderButton({ order }: { order: OrderDto }) {
  const reorder = useReorder(order);
  return (
    <button type="button" onClick={reorder} className={SECONDARY_LINK}>
      <Icon name="refresh" className="text-[20px]" />
      Оформить заново
    </button>
  );
}

function Actions({ order }: { order: OrderDto }) {
  switch (order.status) {
    case 'awaiting_payment':
      return order.paymentUrl ? (
        <Button isFullWidth icon="credit_card" onClick={() => openExternalLink(order.paymentUrl as string)}>
          Оплатить {formatRub(order.amountKopecks)}
        </Button>
      ) : (
        <ActionLink to={`/orders/${order.id}`} icon="chevron_right" isPrimary>
          Открыть заказ
        </ActionLink>
      );
    case 'paid':
    case 'download_confirmed':
    case 'credentials_issued':
      return (
        <div className="grid grid-cols-[1.4fr_1fr] gap-space-sm">
          <ActionLink to={`/orders/${order.id}`} icon="download" isPrimary>
            Продолжить
          </ActionLink>
          <ActionLink to="/guide" icon="help">
            Инструкция
          </ActionLink>
        </div>
      );
    case 'expired':
    case 'failed':
    case 'cancelled':
      return <ReorderButton order={order} />;
    case 'completed':
    case 'refunded':
      return null;
  }
}

export function OrderCard({ order }: { order: OrderDto }) {
  const meta = ORDER_STATUS_META[order.status];
  return (
    <article aria-label={`Заказ #${order.id}`} className="flex flex-col gap-space-md rounded-xl bg-surface-container p-space-lg">
      <Link to={`/orders/${order.id}`} className="-m-1 flex items-start gap-space-md rounded-lg p-1">
        <AppIconStack items={order.items} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-baseline justify-between gap-space-sm">
            <span className="truncate text-headline-sm text-on-surface">{formatOrderTitle(order.items)}</span>
            <span className="shrink-0 text-label-md text-on-surface-variant">{formatOrderDate(order.createdAt)}</span>
          </div>
          <span className={`flex items-center gap-1.5 text-label-lg ${TEXT_CLASSES[meta.tone]}`}>
            <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_CLASSES[meta.tone]}`} />
            <span>
              {meta.label}
              {order.status === 'awaiting_payment' && order.expiresAt && <TimeLeft expiresAt={order.expiresAt} />}
            </span>
          </span>
          <span className="tabular text-body-sm text-on-surface-variant">
            Заказ #{order.id}, {formatRub(order.amountKopecks)}
            {order.discountKopecks > 0 && <span className="text-success">, скидка {formatRub(order.discountKopecks)}</span>}
          </span>
        </div>
      </Link>
      <Actions order={order} />
    </article>
  );
}
