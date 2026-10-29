import type { MeDto } from '@istock/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { LEGAL_PATHS, LEGAL_TITLES } from '../../content/legal';
import { api, errorMessage } from '../../lib/api';
import { formatSubscribers } from '../../lib/format';
import { POP_SPRING, REVEAL } from '../../lib/motion';
import { queryKeys } from '../../lib/queries';
import { hapticNotify, openTelegramLink } from '../../lib/telegram';

type Props = {
  me: MeDto;
};

const FALLBACK_TITLE = 'Наш канал';

function ChannelCard({ me }: Props) {
  const title = me.channel.title ?? FALLBACK_TITLE;
  return (
    <button
      type="button"
      onClick={() => openTelegramLink(me.channelUrl)}
      className="flex w-full items-center gap-space-md rounded-xl bg-surface-container-high p-space-md text-left transition-[background-color,transform] hover:bg-surface-bright active:scale-[0.99]"
    >
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary-container text-headline-md text-white">
        {title.charAt(0).toUpperCase()}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-headline-sm text-on-surface">{title}</span>
        <span className="text-body-sm text-on-surface-variant">Новые приложения и новости</span>
        {me.channel.subscriberCount !== null && (
          <span className="tabular text-label-md text-secondary">{formatSubscribers(me.channel.subscriberCount)}</span>
        )}
      </span>
      <Icon name="open_in_new" className="text-[22px] text-on-surface-variant" />
    </button>
  );
}

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

  const isNotFound = check.data?.isSubscribed === false && !check.isPending;

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-xl flex-col justify-center gap-space-xl px-margin py-10">
      <section className="relative flex flex-col items-center gap-space-sm text-center">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-16 h-56 w-56 rounded-full bg-primary-container/25 blur-3xl"
        />
        <motion.span
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={POP_SPRING}
          className="relative mb-space-sm flex h-20 w-20 items-center justify-center rounded-full bg-primary-container text-white shadow-[0_12px_32px_-8px_rgba(37,99,235,0.6)] ring-8 ring-primary-container/15"
        >
          <Icon name="send" className="-rotate-12 text-[36px]" isFilled />
        </motion.span>
        <h1 className="relative text-headline-lg tracking-tight text-on-surface">Подпишитесь на канал</h1>
        <p className="relative max-w-[32ch] text-body-md text-on-surface-variant">
          Магазин открыт для подписчиков. В канале выходят новые приложения и важные новости.
        </p>
      </section>

      <ChannelCard me={me} />

      <AnimatePresence initial={false}>
        {isNotFound && (
          <motion.div
            key="not-found"
            {...REVEAL}
            role="alert"
            className="flex gap-space-sm rounded-xl bg-error-container/25 p-space-md ring-1 ring-inset ring-error/20"
          >
            <Icon name="error" className="mt-0.5 text-[22px] text-error" />
            <div className="flex flex-col gap-0.5">
              <span className="text-label-lg text-error">Подписка не найдена</span>
              <span className="text-body-sm text-on-surface-variant">
                Откройте канал, нажмите «Подписаться» и проверьте ещё раз.
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {check.isError && (
        <p role="alert" className="text-center text-body-sm text-error">
          {errorMessage(check.error)}
        </p>
      )}

      <div className="flex flex-col gap-space-sm">
        <Button size="lg" isFullWidth icon="send" onClick={() => openTelegramLink(me.channelUrl)}>
          Подписаться
        </Button>
        <Button size="lg" variant="secondary" isFullWidth icon="refresh" isLoading={check.isPending} onClick={() => check.mutate()}>
          Проверить подписку
        </Button>
      </div>

      <button
        type="button"
        onClick={() => openTelegramLink(me.supportUrl)}
        className="mx-auto flex items-center gap-1.5 rounded-full px-3 py-2 text-body-sm text-on-surface-variant transition-colors hover:text-primary"
      >
        <Icon name="help" className="text-[18px]" />
        Нужна помощь? Поддержка
      </button>

      <nav aria-label="Документы" className="flex flex-wrap justify-center gap-x-space-md gap-y-1 text-label-sm text-outline">
        <Link to={LEGAL_PATHS.terms} className="transition-colors hover:text-primary">
          {LEGAL_TITLES.terms}
        </Link>
        <Link to={LEGAL_PATHS.privacy} className="transition-colors hover:text-primary">
          {LEGAL_TITLES.privacy}
        </Link>
      </nav>
    </main>
  );
}
