import { TICKET_MESSAGE_MAX, TICKET_MESSAGE_MIN } from '@istock/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Page } from '../../components/layout/Page';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { api, errorMessage } from '../../lib/api';
import { queryKeys, useMe } from '../../lib/queries';
import { hapticNotify, openTelegramLink } from '../../lib/telegram';

const NO_ORDER = '';

export function TicketPage() {
  const [params] = useSearchParams();
  const [message, setMessage] = useState('');
  const [orderId, setOrderId] = useState(params.get('order') ?? NO_ORDER);
  const orders = useQuery({ queryKey: queryKeys.orders, queryFn: api.orders });
  const { data: me } = useMe();

  const submit = useMutation({
    mutationFn: () =>
      api.createTicket({ message: message.trim(), orderId: orderId === NO_ORDER ? null : Number(orderId) }),
    onSuccess: () => hapticNotify('success'),
    onError: () => hapticNotify('error'),
  });

  const length = message.trim().length;
  const isValid = length >= TICKET_MESSAGE_MIN && length <= TICKET_MESSAGE_MAX;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (isValid) submit.mutate();
  };

  if (submit.isSuccess) {
    return (
      <Page subtitle="Поддержка" hasBackButton hasBottomNav={false}>
        <section className="mt-6 flex flex-col items-center gap-3 rounded-xl bg-surface-container px-6 py-10 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success/15 text-success">
            <Icon name="check_circle" className="text-[30px]" />
          </span>
          <h1 className="text-headline-md text-on-surface">Обращение #{submit.data.id} отправлено</h1>
          <p className="text-body-sm text-on-surface-variant">
            Администратор получил уведомление и свяжется с вами в Telegram.
          </p>
          <Link to="/" className="mt-2 text-label-lg text-primary">
            Вернуться в каталог
          </Link>
        </section>
      </Page>
    );
  }

  return (
    <Page subtitle="Поддержка" hasBackButton hasBottomNav={false}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-space-lg">
        <h1 className="mt-space-xs text-headline-md tracking-tight text-on-surface">Новое обращение</h1>

        <label className="flex flex-col gap-space-sm">
          <span className="text-label-lg text-on-surface">Заказ</span>
          <select
            value={orderId}
            onChange={(event) => setOrderId(event.target.value)}
            className="h-11 rounded-lg bg-surface-container-lowest px-3 text-body-md text-on-surface ring-1 ring-white/10 focus:outline-none focus:ring-2 focus:ring-primary-container"
          >
            <option value={NO_ORDER}>Без заказа</option>
            {orders.data?.map((order) => (
              <option key={order.id} value={String(order.id)}>
                #{order.id}, {order.app.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-space-sm">
          <span className="text-label-lg text-on-surface">Что случилось?</span>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={TICKET_MESSAGE_MAX}
            rows={6}
            placeholder="Например: не приходит код подтверждения"
            className="resize-none rounded-lg bg-surface-container-lowest p-3 text-body-md text-on-surface ring-1 ring-white/10 placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary-container"
          />
          <span className="tabular self-end text-label-md text-outline">
            {length}/{TICKET_MESSAGE_MAX}
          </span>
        </label>

        {submit.isError && (
          <p role="alert" className="text-body-sm text-error">
            {errorMessage(submit.error)}
          </p>
        )}

        <Button type="submit" size="lg" isFullWidth icon="send" disabled={!isValid} isLoading={submit.isPending}>
          Отправить
        </Button>
        {me && (
          <button
            type="button"
            onClick={() => openTelegramLink(me.supportUrl)}
            className="flex items-center justify-center gap-1.5 text-label-lg text-primary"
          >
            <Icon name="support_agent" className="text-[18px]" />
            Или написать в поддержку напрямую
          </button>
        )}
      </form>
    </Page>
  );
}
