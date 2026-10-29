import { formatRub, type OrderDto, type OrderStatus } from '@istock/shared';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { SupportButton } from '../../components/SupportButton';
import { AppIcon } from '../../components/ui/AppIcon';
import { Badge } from '../../components/ui/Badge';
import { Icon } from '../../components/ui/Icon';
import { useReorder } from '../../hooks/useReorder';
import { formatOrderDate } from '../../lib/format';
import type { IconName } from '../../lib/icons';
import { POP_SPRING } from '../../lib/motion';
import { ORDER_STATUS_META, PAYMENT_METHOD_META } from '../../lib/order-status';

export type ClosedStatus = Extract<OrderStatus, 'failed' | 'expired' | 'cancelled' | 'refunded'>;

export const CLOSED_STATUSES: readonly OrderStatus[] = ['failed', 'expired', 'cancelled', 'refunded'];

export function isClosedStatus(status: OrderStatus): status is ClosedStatus {
  return CLOSED_STATUSES.includes(status);
}

/** Only a rejected payment is an error; an expired or cancelled invoice is just closed. */
type Severity = 'error' | 'neutral';

type Copy = { icon: IconName; title: string; text: string; canReorder: boolean; severity: Severity };

const ICON_CLASSES: Record<Severity, string> = {
  error: 'bg-error-container/25 text-error ring-error-container/10',
  neutral: 'bg-surface-container-high text-on-surface-variant ring-surface-container',
};

const COPY: Record<ClosedStatus, Copy> = {
  expired: {
    icon: 'timer_off',
    title: 'Счёт истёк',
    text: 'Оплата не поступила за 30 минут, и счёт закрылся. Можно оформить заказ заново.',
    canReorder: true,
    severity: 'neutral',
  },
  cancelled: {
    icon: 'cancel',
    title: 'Заказ отменён',
    text: 'Вы отменили этот заказ. Если передумали, оформите его заново.',
    canReorder: true,
    severity: 'neutral',
  },
  failed: {
    icon: 'error',
    title: 'Оплата не прошла',
    text: 'Банк или платёжный сервис отклонил платёж. Попробуйте ещё раз или выберите другой способ оплаты.',
    canReorder: true,
    severity: 'error',
  },
  refunded: {
    icon: 'undo',
    title: 'Деньги возвращены',
    text: 'По этому заказу оформлен возврат. Если это ошибка, напишите в поддержку.',
    canReorder: false,
    severity: 'neutral',
  },
};

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-space-md py-2.5">
      <dt className="text-body-sm text-on-surface-variant">{label}</dt>
      <dd className="tabular text-right text-label-lg text-on-surface">{children}</dd>
    </div>
  );
}

type Props = {
  order: OrderDto;
  status: ClosedStatus;
};

function OrderItems({ order }: { order: OrderDto }) {
  return (
    <ul aria-label="Приложения заказа" className="flex flex-col gap-space-xs">
      {order.items.map((item) => (
        <li key={item.id} className="flex items-center gap-space-md rounded-lg bg-surface-container-high p-space-md">
          <AppIcon src={item.iconUrl} size={order.items.length > 1 ? 'sm' : 'md'} />
          <span className="min-w-0 flex-1 truncate text-headline-sm text-on-surface">{item.name}</span>
          <span className="tabular text-headline-sm text-on-surface">
            {formatRub(item.priceKopecks - item.discountKopecks)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function PaymentClosed({ order, status }: Props) {
  const copy = COPY[status];
  const meta = ORDER_STATUS_META[status];
  const reorder = useReorder(order);

  return (
    <div className="flex flex-col gap-space-lg">
      <section className="flex flex-col items-center gap-space-sm pt-space-sm text-center">
        <motion.span
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={POP_SPRING}
          className={`mb-space-xs flex h-20 w-20 items-center justify-center rounded-full ring-8 ${ICON_CLASSES[copy.severity]}`}
        >
          <Icon name={copy.icon} className="text-[38px]" />
        </motion.span>
        <h1 className="text-balance text-headline-lg tracking-tight text-on-surface">{copy.title}</h1>
        <p className="max-w-[34ch] text-body-md text-on-surface-variant">{copy.text}</p>
      </section>

      <section aria-label="Детали заказа" className="rounded-xl bg-surface-container p-space-lg">
        <OrderItems order={order} />
        <dl className="mt-space-sm divide-y divide-white/5">
          {order.discountKopecks > 0 && (
            <DetailRow label="Скидка">
              <span className="text-success">−{formatRub(order.discountKopecks)}</span>
            </DetailRow>
          )}
          <DetailRow label="Итого">{formatRub(order.amountKopecks)}</DetailRow>
          <DetailRow label="Статус">
            <Badge label={meta.label} tone={copy.severity === 'error' ? 'danger' : 'neutral'} icon={meta.icon} />
          </DetailRow>
          <DetailRow label="Способ оплаты">{PAYMENT_METHOD_META[order.paymentMethod].label}</DetailRow>
          <DetailRow label="Создан">{formatOrderDate(order.createdAt)}</DetailRow>
          <DetailRow label="Номер заказа">#{order.id}</DetailRow>
        </dl>

        {status !== 'refunded' && (
          <div className="mt-space-md flex gap-space-sm rounded-lg bg-secondary-container/10 p-space-md">
            <Icon name="currency_exchange" className="mt-0.5 text-[20px] text-secondary" />
            <p className="text-body-sm text-on-surface-variant">
              <span className="font-semibold text-on-surface">Если банк всё же списал деньги,</span> заказ оплатится
              автоматически, как только платёж дойдёт до нас. Если этого не произошло, напишите в поддержку и укажите
              номер заказа.
            </p>
          </div>
        )}
      </section>

      <div className="flex flex-col gap-space-sm">
        {copy.canReorder && (
          <button
            type="button"
            onClick={reorder}
            className="flex h-12 items-center justify-center gap-2 rounded-full bg-primary-container text-label-lg text-on-primary shadow-lg shadow-primary-container/25 transition-transform active:scale-[0.97]"
          >
            <Icon name="refresh" className="text-[20px]" />
            Оформить заново
          </button>
        )}
        <SupportButton isSecondary={copy.canReorder} />
        <Link
          to="/"
          className="flex min-h-11 items-center justify-center text-label-lg text-on-surface-variant transition-colors hover:text-on-surface"
        >
          Вернуться в каталог
        </Link>
      </div>
    </div>
  );
}
