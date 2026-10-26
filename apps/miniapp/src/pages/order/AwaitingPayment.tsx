import type { OrderDto } from '@istock/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { useSecondsUntil } from '../../hooks/useSecondsUntil';
import { api, errorMessage } from '../../lib/api';
import { formatCountdown } from '../../lib/format';
import { REVEAL } from '../../lib/motion';
import { PAYMENT_METHOD_META } from '../../lib/order-status';
import { ORDER_POLL_MS, queryKeys } from '../../lib/queries';
import { hapticImpact, hapticNotify, openExternalLink } from '../../lib/telegram';

/** Under two minutes the timer turns red: the buyer should finish now or start over. */
const URGENT_SECONDS = 120;
const POLL_SECONDS = Math.round(ORDER_POLL_MS / 1000);

type Props = {
  order: OrderDto;
  isRefreshing: boolean;
  onRefresh: () => void;
};

function InvoiceTimer({ expiresAt, onExpire }: { expiresAt: string; onExpire: () => void }) {
  const secondsLeft = useSecondsUntil(expiresAt);
  const isExpired = secondsLeft === 0;

  useEffect(() => {
    // The server learns about the expiry from CISPAY; ask for the fresh status once.
    if (isExpired) onExpire();
  }, [isExpired, onExpire]);

  if (isExpired) {
    return <p className="text-body-md text-on-surface-variant">Время на оплату вышло. Проверяем статус счёта.</p>;
  }

  const tone = secondsLeft <= URGENT_SECONDS ? 'text-error' : 'text-on-surface';
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-body-sm text-on-surface-variant">Счёт действителен ещё</span>
      <span role="timer" className={`tabular flex items-center gap-2 text-display transition-colors ${tone}`}>
        <Icon name="schedule" className="text-[30px] text-warning" />
        {formatCountdown(secondsLeft)}
      </span>
    </div>
  );
}

function CancelOrder({ orderId }: { orderId: number }) {
  const queryClient = useQueryClient();
  const [isConfirming, setIsConfirming] = useState(false);
  const cancel = useMutation({
    mutationFn: () => api.cancelOrder(orderId),
    onSuccess: (updated) => {
      hapticNotify('success');
      queryClient.setQueryData(queryKeys.order(orderId), updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.orders });
    },
    onError: () => hapticNotify('error'),
  });

  return (
    <div className="flex flex-col items-center gap-space-sm">
      <AnimatePresence mode="wait" initial={false}>
        {isConfirming ? (
          <motion.div
            key="confirm"
            {...REVEAL}
            className="flex w-full flex-col gap-space-sm rounded-xl bg-error-container/20 p-space-md ring-1 ring-inset ring-error/20"
          >
            <p className="text-center text-body-sm text-on-surface">
              Отменить заказ? Если вы уже оплатили, ничего не делайте: заказ обновится сам.
            </p>
            <div className="grid grid-cols-2 gap-space-sm">
              <Button variant="secondary" onClick={() => setIsConfirming(false)}>
                Не отменять
              </Button>
              <Button
                variant="ghost"
                className="text-error hover:bg-error-container/30"
                isLoading={cancel.isPending}
                onClick={() => cancel.mutate()}
              >
                Да, отменить
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.button
            key="ask"
            type="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => {
              hapticImpact('light');
              setIsConfirming(true);
            }}
            className="rounded-full px-4 py-2 text-label-lg text-error/90 transition-colors hover:bg-error-container/20"
          >
            Отменить заказ
          </motion.button>
        )}
      </AnimatePresence>
      {cancel.isError && (
        <p role="alert" className="text-body-sm text-error">
          {errorMessage(cancel.error)}
        </p>
      )}
    </div>
  );
}

export function AwaitingPayment({ order, isRefreshing, onRefresh }: Props) {
  const method = PAYMENT_METHOD_META[order.paymentMethod];

  return (
    <div className="flex flex-col gap-space-md">
      <section className="relative flex flex-col items-center gap-space-lg overflow-hidden rounded-xl bg-surface-container px-space-lg py-space-xl text-center">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(ellipse_at_top,rgb(245_158_11/0.14),transparent_70%)]"
        />
        <span className="relative">
          <Badge label="Ожидание оплаты" tone="warning" icon="schedule" />
        </span>
        {order.expiresAt && (
          <div className="relative">
            <InvoiceTimer expiresAt={order.expiresAt} onExpire={onRefresh} />
          </div>
        )}
        <p className="relative max-w-[34ch] text-body-sm text-on-surface-variant">
          Оплатите счёт на странице CISPAY. Статус обновится сам, как только платёж подтвердится, эту страницу можно не закрывать.
        </p>
        <p className="relative flex items-center gap-1.5 text-label-md text-on-surface-variant">
          <Icon name="autorenew" className="text-[18px] text-secondary" />
          {`Статус проверяется автоматически каждые ${POLL_SECONDS} с`}
        </p>
      </section>

      {order.paymentUrl && (
        <Button size="lg" isFullWidth icon={method.icon} onClick={() => openExternalLink(order.paymentUrl as string)}>
          {method.payLabel}
        </Button>
      )}
      <Button variant="secondary" size="lg" isFullWidth icon="refresh" isLoading={isRefreshing} onClick={onRefresh}>
        Проверить статус платежа
      </Button>

      <CancelOrder orderId={order.id} />
    </div>
  );
}
