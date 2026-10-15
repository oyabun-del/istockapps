import type { OrderDto, OrderStatus } from '@istock/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { CopyField } from '../../components/ui/CopyField';
import { Icon } from '../../components/ui/Icon';
import { Spinner } from '../../components/ui/Spinner';
import { api, errorMessage } from '../../lib/api';
import { REVEAL } from '../../lib/motion';
import { queryKeys } from '../../lib/queries';
import { hapticNotify, openExternalLink } from '../../lib/telegram';
import { LoginCodeBox } from './LoginCodeBox';
import { StepCard, type StepState } from './StepCard';

const STATUS_ORDER: readonly OrderStatus[] = ['paid', 'download_confirmed', 'credentials_issued', 'completed'];

/** Step N is active when the order is at status STATUS_ORDER[N], done when beyond it. */
function stepState(status: OrderStatus, stepStatus: OrderStatus): StepState {
  const current = STATUS_ORDER.indexOf(status);
  const step = STATUS_ORDER.indexOf(stepStatus);
  if (current > step) return 'done';
  return current === step ? 'active' : 'locked';
}

function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-body-sm text-error">
      {errorMessage(error)}
    </p>
  );
}

function DownloadStep({ order }: { order: OrderDto }) {
  const queryClient = useQueryClient();
  const state = stepState(order.status, 'paid');

  const download = useMutation({
    mutationFn: () => api.download(order.id),
    onSuccess: ({ url }) => openExternalLink(url),
  });
  const confirm = useMutation({
    mutationFn: () => api.confirmDownload(order.id),
    onSuccess: (updated) => {
      hapticNotify('success');
      queryClient.setQueryData(queryKeys.order(order.id), updated);
    },
  });

  return (
    <StepCard index={1} title="Скачайте приложение" state={state}>
      <p className="text-body-sm text-on-surface-variant">
        Нажмите «Скачать», дождитесь окончания загрузки и подтвердите её кнопкой ниже.
      </p>
      <Button
        isFullWidth
        variant={state === 'done' ? 'secondary' : 'primary'}
        icon="download"
        isLoading={download.isPending}
        onClick={() => download.mutate()}
      >
        {state === 'done' ? 'Скачать снова' : 'Скачать'}
      </Button>
      {state === 'active' && (
        <Button isFullWidth variant="secondary" icon="task_alt" isLoading={confirm.isPending} onClick={() => confirm.mutate()}>
          Я скачал
        </Button>
      )}
      <ErrorText error={download.error ?? confirm.error} />
    </StepCard>
  );
}

function CredentialsStep({ order }: { order: OrderDto }) {
  const queryClient = useQueryClient();
  const state = stepState(order.status, 'download_confirmed');
  const [isRequested, setIsRequested] = useState(false);
  const isIssued = order.status === 'credentials_issued' || order.status === 'completed';

  const credentials = useQuery({
    queryKey: queryKeys.credentials(order.id),
    queryFn: async () => {
      const result = await api.credentials(order.id);
      if (!isIssued) void queryClient.invalidateQueries({ queryKey: queryKeys.order(order.id) });
      return result;
    },
    enabled: isIssued || isRequested,
    // Each request may hit the delivery API: fetch once per session, never in the background.
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: false,
  });

  return (
    <StepCard index={2} title="Войдите в App Store" state={state}>
      <div className="flex flex-col gap-1 rounded-lg bg-surface-container-low p-space-sm text-code-sm text-on-surface-variant">
        <span className="flex items-center gap-space-xs">
          <Icon name="settings" className="text-[16px] text-primary" />
          Настройки → Ваше имя
        </span>
        <span className="flex items-center gap-space-xs pl-4">
          <Icon name="subdirectory_arrow_right" className="text-[14px] text-outline" />
          <span className="font-semibold text-on-surface">Медиаматериалы и покупки</span>
        </span>
      </div>
      <p className="flex items-start gap-1.5 rounded-lg bg-warning/10 p-space-sm text-body-sm text-warning">
        <Icon name="warning" className="mt-0.5 text-[16px]" />
        Входите только в App Store. Не входите с этими данными в iCloud.
      </p>

      {credentials.data ? (
        <motion.div {...REVEAL} className="flex flex-col gap-2">
          <CopyField label="Логин" value={credentials.data.login} />
          <CopyField label="Пароль" value={credentials.data.password} isSecret />
        </motion.div>
      ) : credentials.isFetching ? (
        <div className="flex justify-center py-2 text-primary">
          <Spinner />
        </div>
      ) : (
        <Button isFullWidth icon="key" onClick={() => setIsRequested(true)}>
          Получить логин и пароль
        </Button>
      )}
      <ErrorText error={credentials.error} />
    </StepCard>
  );
}

function FinishStep({ order }: { order: OrderDto }) {
  const queryClient = useQueryClient();
  const state = stepState(order.status, 'credentials_issued');
  const complete = useMutation({
    mutationFn: () => api.complete(order.id),
    onSuccess: (updated) => {
      hapticNotify('success');
      queryClient.setQueryData(queryKeys.order(order.id), updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.orders });
    },
  });

  if (order.status === 'completed') {
    return (
      <StepCard index={4} title="Приложение активировано" state="done" isLast>
        <p className="text-body-sm text-on-surface-variant">
          Готово! Теперь выйдите из выданного аккаунта в «Медиаматериалы и покупки» и войдите в свой Apple ID.
        </p>
      </StepCard>
    );
  }

  return (
    <StepCard index={4} title="Откройте приложение" state={state} isLast>
      <p className="text-body-sm text-on-surface-variant">
        Запустите приложение на iPhone. Если оно открылось, подтвердите активацию.
      </p>
      <Button isFullWidth icon="verified" isLoading={complete.isPending} onClick={() => complete.mutate()}>
        Приложение работает
      </Button>
      <ErrorText error={complete.error} />
    </StepCard>
  );
}

type Props = {
  order: OrderDto;
};

export function DeliverySteps({ order }: Props) {
  const codeState = stepState(order.status, 'credentials_issued');
  return (
    <section aria-labelledby="steps-heading" className="flex flex-col gap-space-md">
      <div className="flex items-center justify-between px-space-xs">
        <h2 id="steps-heading" className="flex items-center gap-space-xs text-headline-sm text-on-surface">
          <Icon name="verified" className="text-[20px] text-primary" />
          Получение и активация
        </h2>
        <span className="rounded-full bg-secondary-container/20 px-space-sm py-0.5 text-label-sm text-secondary">4 шага</span>
      </div>
      <ol className="flex flex-col gap-space-md">
        <DownloadStep order={order} />
        <CredentialsStep order={order} />
        <StepCard index={3} title="Введите код подтверждения" state={codeState}>
          <LoginCodeBox orderId={order.id} />
        </StepCard>
        <FinishStep order={order} />
      </ol>
    </section>
  );
}
