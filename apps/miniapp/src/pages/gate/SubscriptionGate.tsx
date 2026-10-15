import type { MeDto } from '@istock/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { api, errorMessage } from '../../lib/api';
import { queryKeys } from '../../lib/queries';
import { hapticNotify, openTelegramLink } from '../../lib/telegram';

type Props = {
  me: MeDto;
};

export function SubscriptionGate({ me }: Props) {
  const queryClient = useQueryClient();
  const check = useMutation({
    mutationFn: api.checkSubscription,
    onSuccess: ({ isSubscribed }) => {
      hapticNotify(isSubscribed ? 'success' : 'warning');
      if (!isSubscribed) return;
      queryClient.setQueryData<MeDto>(queryKeys.me, { ...me, isSubscribed: true });
      void queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== 'me' });
    },
  });

  const isStillMissing = check.data?.isSubscribed === false;

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-xl flex-col justify-center px-margin py-10">
      <section className="relative overflow-hidden rounded-2xl bg-surface-container-high p-space-xl text-center">
        <div className="pointer-events-none absolute -left-16 -top-16 h-48 w-48 rounded-full bg-primary-container/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -right-10 h-48 w-48 rounded-full bg-secondary-container/20 blur-3xl" />

        <span className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-container text-white shadow-[0_0_24px_-2px_rgba(37,99,235,0.6)]">
          <Icon name="campaign" className="text-[34px]" />
        </span>
        <h1 className="relative mt-space-lg text-headline-lg text-on-surface">Подпишитесь на канал</h1>
        <p className="relative mt-space-sm text-body-md text-on-surface-variant">
          Магазин открыт для подписчиков канала. Там же выходят новые приложения и важные новости.
        </p>

        <div className="relative mt-space-xl flex flex-col gap-space-sm">
          <Button size="lg" isFullWidth icon="open_in_new" onClick={() => openTelegramLink(me.channelUrl)}>
            Открыть канал
          </Button>
          <Button size="lg" variant="secondary" isFullWidth icon="refresh" isLoading={check.isPending} onClick={() => check.mutate()}>
            Я подписался
          </Button>
        </div>

        {isStillMissing && (
          <p role="alert" className="relative mt-space-md text-body-sm text-warning">
            Подписка пока не найдена. Подпишитесь и нажмите ещё раз.
          </p>
        )}
        {check.isError && (
          <p role="alert" className="relative mt-space-md text-body-sm text-error">
            {errorMessage(check.error)}
          </p>
        )}
      </section>
    </main>
  );
}
