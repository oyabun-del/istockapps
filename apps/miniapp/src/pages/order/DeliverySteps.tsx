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

const STEP_KEYS = ['download', 'credentials', 'code', 'finish'] as const;
type StepKey = (typeof STEP_KEYS)[number];
type StepProgress = StepState | 'locked';

/** While a replacement account is being found, re-read the delivery with a growing pause. */
const REPLACING_POLL_BASE_MS = 15_000;
const REPLACING_POLL_MAX_MS = 120_000;
const MAX_BACKOFF_STEPS = 3;

/** Step N is active when the order is at status STATUS_ORDER[N], done when beyond it. */
function statusStep(status: OrderStatus, stepStatus: OrderStatus): StepProgress {
  const current = STATUS_ORDER.indexOf(status);
  const step = STATUS_ORDER.indexOf(stepStatus);
  if (current > step) return 'done';
  return current === step ? 'active' : 'locked';
}

/** Each step opens only after the previous one is done; the code step ends with a code or a skip. */
function stepProgress(order: OrderDto): Record<StepKey, StepProgress> {
  const isActivating = order.status === 'credentials_issued';
  return {
    download: statusStep(order.status, 'paid'),
    credentials: statusStep(order.status, 'download_confirmed'),
    code: order.isCodeReceived ? 'done' : isActivating ? 'active' : 'locked',
    finish: order.status === 'completed' ? 'done' : isActivating && order.isCodeReceived ? 'active' : 'locked',
  };
}

function progressLabel(progress: Record<StepKey, StepProgress>): string {
  const active = STEP_KEYS.findIndex((key) => progress[key] === 'active');
  return active === -1 ? 'Готово' : `Шаг ${active + 1} из ${STEP_KEYS.length}`;
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

type CardProps = { state: StepState; isNew: boolean; isLast: boolean };

function DownloadStep({ order, delivery, card }: { order: OrderDto; delivery: DeliveryQuery; card: CardProps }) {
  const queryClient = useQueryClient();
  const confirm = useMutation({
    mutationFn: () => api.confirmDownload(order.id),
    onSuccess: (updated) => {
      hapticNotify('success');
      queryClient.setQueryData(queryKeys.order(order.id), updated);
    },
  });
  const hasLinks = availableGroups(delivery.data).length > 0;

  return (
    <StepCard index={1} title="Скачайте приложение" {...card}>
      <p className="text-body-sm text-on-surface-variant">
        Нажмите «Скачать», дождитесь окончания загрузки и подтвердите её кнопкой ниже.
      </p>
      {delivery.data && <DeliveryApps delivery={delivery.data} isDone={card.state === 'done'} />}
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
      {card.state === 'active' && hasLinks && (
        <Button isFullWidth variant="secondary" icon="task_alt" isLoading={confirm.isPending} onClick={() => confirm.mutate()}>
          Я скачал
        </Button>
      )}
      <ErrorText error={delivery.error ?? confirm.error} />
    </StepCard>
  );
}

function CredentialsStep({ order, delivery, card }: { order: OrderDto; delivery: DeliveryDto | undefined; card: CardProps }) {
  const queryClient = useQueryClient();
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
    <StepCard index={2} title="Войдите в App Store" {...card}>
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

function CodeStep({ order, delivery, card }: { order: OrderDto; delivery: DeliveryDto | undefined; card: CardProps }) {
  const queryClient = useQueryClient();
  const groups = availableGroups(delivery);
  const skip = useMutation({
    mutationFn: () => api.skipCode(order.id),
    onSuccess: (updated) => queryClient.setQueryData(queryKeys.order(order.id), updated),
  });

  return (
    <StepCard index={3} title="Введите код подтверждения" {...card}>
      {groups.length === 0 && (
        <p className="text-body-sm text-on-surface-variant">Код станет доступен, когда появится рабочий аккаунт.</p>
      )}
      {groups.map((group) => (
        // Keyed by group id: a replaced group starts from scratch, never with the old wait or code.
        <LoginCodeBox key={group.id} orderId={order.id} groupId={group.id} codesLeft={group.codesLeft} />
      ))}
      {card.state === 'active' && (
        <Button isFullWidth variant="ghost" icon="task_alt" isLoading={skip.isPending} onClick={() => skip.mutate()}>
          Apple не запросил код
        </Button>
      )}
      <ErrorText error={skip.error} />
    </StepCard>
  );
}

function FinishStep({ order, card }: { order: OrderDto; card: CardProps }) {
  const queryClient = useQueryClient();
  const complete = useMutation({
    mutationFn: () => api.complete(order.id),
    onSuccess: (updated) => {
      hapticNotify('success');
      queryClient.setQueryData(queryKeys.order(order.id), updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.orders });
    },
  });

  if (card.state === 'done') {
    return (
      <StepCard index={4} title="Приложение активировано" {...card}>
        <p className="text-body-sm text-on-surface-variant">
          Готово! Теперь выйдите из выданного аккаунта в «Медиаматериалы и покупки» и войдите в свой Apple ID.
        </p>
      </StepCard>
    );
  }

  return (
    <StepCard index={4} title="Откройте приложение" {...card}>
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
  const progress = stepProgress(order);
  const visible = STEP_KEYS.filter((key) => progress[key] !== 'locked');
  // Steps that open while the buyer is on the page are animated in and scrolled to.
  const [initiallyVisible] = useState(visible);

  const card = (key: StepKey, state: StepState): CardProps => ({
    state,
    isNew: !initiallyVisible.includes(key),
    isLast: key === visible.at(-1),
  });

  return (
    <section aria-labelledby="steps-heading" className="flex flex-col gap-space-md">
      <div className="flex items-center justify-between px-space-xs">
        <h2 id="steps-heading" className="flex items-center gap-space-xs text-headline-sm text-on-surface">
          <Icon name="verified" className="text-[20px] text-primary" />
          Получение и активация
        </h2>
        <span className="tabular rounded-full bg-secondary-container/20 px-space-sm py-0.5 text-label-sm text-secondary">
          {progressLabel(progress)}
        </span>
      </div>
      <ol className="flex flex-col gap-space-md">
        {progress.download !== 'locked' && (
          <DownloadStep order={order} delivery={delivery} card={card('download', progress.download)} />
        )}
        {progress.credentials !== 'locked' && (
          <CredentialsStep order={order} delivery={delivery.data} card={card('credentials', progress.credentials)} />
        )}
        {progress.code !== 'locked' && (
          <CodeStep order={order} delivery={delivery.data} card={card('code', progress.code)} />
        )}
        {progress.finish !== 'locked' && <FinishStep order={order} card={card('finish', progress.finish)} />}
      </ol>
    </section>
  );
}
