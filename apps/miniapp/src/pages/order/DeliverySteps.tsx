import type { DeliveryDto, DeliveryGroupDto, OrderDto, OrderStatus } from '@istock/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { CopyField } from '../../components/ui/CopyField';
import { Icon } from '../../components/ui/Icon';
import { SettingsPath } from '../../components/ui/SettingsPath';
import { Spinner } from '../../components/ui/Spinner';
import { MEDIA_PURCHASES_PATH } from '../../content/guide';
import { api, errorMessage } from '../../lib/api';
import { REVEAL } from '../../lib/motion';
import { queryKeys } from '../../lib/queries';
import { hapticNotify } from '../../lib/telegram';
import { DeliveryApps } from './DeliveryApps';
import { LoginCodeBox } from './LoginCodeBox';
import { StepCard, type StepState } from './StepCard';

const STATUS_ORDER: readonly OrderStatus[] = ['paid', 'download_confirmed', 'credentials_issued', 'completed'];

/** While a replacement account is being found, re-read the delivery with a growing pause. */
const REPLACING_POLL_BASE_MS = 15_000;
const REPLACING_POLL_MAX_MS = 120_000;
const MAX_BACKOFF_STEPS = 3;

/** Step N is active when the order is at status STATUS_ORDER[N], done when beyond it. */
function stepState(status: OrderStatus, stepStatus: OrderStatus): StepState {
  const current = STATUS_ORDER.indexOf(status);
  const step = STATUS_ORDER.indexOf(stepStatus);
  if (current > step) return 'done';
  return current === step ? 'active' : 'locked';
}

function availableGroups(delivery: DeliveryDto | undefined): DeliveryGroupDto[] {
  return delivery?.groups.filter((group) => group.state === 'available') ?? [];
}

function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-body-sm text-error">
      {errorMessage(error)}
    </p>
  );
}

/**
 * Fresh delivery snapshot: read on every visit and on return to the app, never merged with an
 * older one. Polled with backoff only while a replacement is pending.
 */
function useDelivery(orderId: number) {
  return useQuery({
    queryKey: queryKeys.delivery(orderId),
    queryFn: () => api.delivery(orderId),
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      if (!query.state.data?.isReplacing) return false;
      const step = Math.min(query.state.dataUpdateCount, MAX_BACKOFF_STEPS);
      return Math.min(REPLACING_POLL_BASE_MS * 2 ** step, REPLACING_POLL_MAX_MS);
    },
  });
}

type DeliveryQuery = ReturnType<typeof useDelivery>;

function DownloadStep({ order, delivery }: { order: OrderDto; delivery: DeliveryQuery }) {
  const queryClient = useQueryClient();
  const state = stepState(order.status, 'paid');
  const confirm = useMutation({
    mutationFn: () => api.confirmDownload(order.id),
    onSuccess: (updated) => {
      hapticNotify('success');
      queryClient.setQueryData(queryKeys.order(order.id), updated);
    },
  });
  const hasLinks = availableGroups(delivery.data).length > 0;

  return (
    <StepCard index={1} title="Скачайте приложение" state={state}>
      <p className="text-body-sm text-on-surface-variant">
        Нажмите «Скачать», дождитесь окончания загрузки и подтвердите её кнопкой ниже.
      </p>
      {delivery.data && <DeliveryApps delivery={delivery.data} isDone={state === 'done'} />}
      {delivery.isPending && (
        <div className="flex justify-center py-2 text-primary">
          <Spinner />
        </div>
      )}
      {delivery.isError && !delivery.isFetching && (
        <Button isFullWidth variant="secondary" icon="refresh" onClick={() => void delivery.refetch()}>
          Повторить
        </Button>
      )}
      {state === 'active' && hasLinks && (
        <Button isFullWidth variant="secondary" icon="task_alt" isLoading={confirm.isPending} onClick={() => confirm.mutate()}>
          Я скачал
        </Button>
      )}
      <ErrorText error={delivery.error ?? confirm.error} />
    </StepCard>
  );
}

function CredentialsStep({ order, delivery }: { order: OrderDto; delivery: DeliveryDto | undefined }) {
  const queryClient = useQueryClient();
  const state = stepState(order.status, 'download_confirmed');
  const [isRequested, setIsRequested] = useState(false);
  const isIssued = order.status === 'credentials_issued' || order.status === 'completed';
  const groups = availableGroups(delivery);
  const groupIds = groups.map((group) => group.id).join(',');

  const credentials = useQuery({
    queryKey: queryKeys.credentials(order.id, groupIds),
    queryFn: async () => {
      const result = await api.credentials(order.id);
      if (!isIssued) void queryClient.invalidateQueries({ queryKey: queryKeys.order(order.id) });
      return result;
    },
    enabled: (isIssued || isRequested) && groups.length > 0,
    // Re-read on every visit and return to the app (a password may change); forget on leave.
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });

  // After a failed request the query stays enabled, so only an explicit refetch tries again.
  const handleRequest = () => {
    if (isRequested || isIssued) void credentials.refetch();
    else setIsRequested(true);
  };

  // Never fall back to a previously shown password after an error.
  const shown = credentials.isError ? undefined : credentials.data;
  const hasManyGroups = (shown?.groups.length ?? 0) > 1;

  return (
    <StepCard index={2} title="Войдите в App Store" state={state}>
      <SettingsPath path={MEDIA_PURCHASES_PATH} />
      <p className="flex items-start gap-1.5 rounded-lg bg-warning/10 p-space-sm text-body-sm text-warning">
        <Icon name="warning" className="mt-0.5 text-[16px]" />
        Входите только в App Store. Не входите с этими данными в iCloud.
      </p>

      {shown ? (
        <motion.div {...REVEAL} className="flex flex-col gap-2">
          {shown.groups.map((item, index) => (
            <div key={item.groupId} className="flex flex-col gap-2">
              {hasManyGroups && <span className="text-label-md text-on-surface-variant">Аккаунт {index + 1}</span>}
              <CopyField label="Логин" value={item.login} />
              <CopyField label="Пароль" value={item.password} isSecret />
            </div>
          ))}
        </motion.div>
      ) : credentials.isFetching ? (
        <div className="flex justify-center py-2 text-primary">
          <Spinner />
        </div>
      ) : (
        <Button isFullWidth icon="key" disabled={groups.length === 0} onClick={handleRequest}>
          Получить логин и пароль
        </Button>
      )}
      <ErrorText error={credentials.error} />
    </StepCard>
  );
}

function CodeStep({ order, delivery }: { order: OrderDto; delivery: DeliveryDto | undefined }) {
  const state = stepState(order.status, 'credentials_issued');
  const groups = availableGroups(delivery);
  return (
    <StepCard index={3} title="Введите код подтверждения" state={state}>
      {groups.length === 0 && (
        <p className="text-body-sm text-on-surface-variant">Код станет доступен, когда появится рабочий аккаунт.</p>
      )}
      {groups.map((group) => (
        // Keyed by group id: a replaced group starts from scratch, never with the old wait or code.
        <LoginCodeBox key={group.id} orderId={order.id} groupId={group.id} codesLeft={group.codesLeft} />
      ))}
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
      <Link
        to="/guide"
        className="flex h-11 items-center justify-center gap-2 rounded-full bg-surface-container-high text-label-lg text-on-surface transition-transform active:scale-[0.97]"
      >
        <Icon name="menu_book" className="text-[20px]" />
        Подробная инструкция
      </Link>
      <ErrorText error={complete.error} />
    </StepCard>
  );
}

type Props = {
  order: OrderDto;
};

export function DeliverySteps({ order }: Props) {
  const delivery = useDelivery(order.id);
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
        <DownloadStep order={order} delivery={delivery} />
        <CredentialsStep order={order} delivery={delivery.data} />
        <CodeStep order={order} delivery={delivery.data} />
        <FinishStep order={order} />
      </ol>
    </section>
  );
}
