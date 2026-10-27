import type { CodeWaitDto, CodeWaitStatus } from '@istock/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { Spinner } from '../../components/ui/Spinner';
import { useSecondsUntil } from '../../hooks/useSecondsUntil';
import { api, errorMessage } from '../../lib/api';
import { copyText } from '../../lib/clipboard';
import { formatCountdown } from '../../lib/format';
import { REVEAL } from '../../lib/motion';
import { queryKeys } from '../../lib/queries';
import { hapticNotify } from '../../lib/telegram';

/** The delivery API allows at most one status check per second. */
export const CODE_POLL_MS = 1_500;

type FinishedStatus = Exclude<CodeWaitStatus, 'active' | 'succeeded'>;

const FINISHED_TEXT: Record<FinishedStatus | 'stale', string> = {
  stale: 'Код истёк. Если iPhone снова просит код, включите ожидание ещё раз.',
  code_expired: 'Код истёк. Если iPhone снова просит код, включите ожидание ещё раз.',
  timed_out: 'Код так и не пришёл за 5 минут. Включите ожидание и запросите код на iPhone снова.',
  cancelled: 'Ожидание остановлено: доступ к аккаунту изменился. Мы обновили данные выше.',
};

function CodeDisplay({ code }: { code: string }) {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = async () => {
    const isOk = await copyText(code);
    setIsCopied(isOk);
    hapticNotify(isOk ? 'success' : 'error');
  };

  return (
    <motion.button
      {...REVEAL}
      type="button"
      onClick={handleCopy}
      aria-label={`Код ${code}. Нажмите, чтобы скопировать`}
      className="flex flex-col items-center gap-1 rounded-xl bg-surface-container-lowest p-space-lg ring-1 ring-primary-container/40 transition-transform active:scale-[0.98]"
    >
      <span className="text-label-sm uppercase text-outline">Код подтверждения</span>
      <span className="tabular font-mono text-display tracking-[0.3em] text-on-surface" aria-live="polite">
        {code}
      </span>
      <span className="flex items-center gap-1 text-label-md text-primary">
        <Icon name={isCopied ? 'check' : 'content_copy'} className="text-[16px]" />
        {isCopied ? 'Скопировано' : 'Нажмите, чтобы скопировать'}
      </span>
    </motion.button>
  );
}

function Countdown({ label, seconds }: { label: string; seconds: number }) {
  return (
    <p role="timer" className="tabular flex items-center justify-center gap-1.5 text-label-md text-secondary">
      <Icon name="schedule" className="text-[16px]" />
      {`${label} ${formatCountdown(seconds)}`}
    </p>
  );
}

function Waiting({ deadlineAt }: { deadlineAt: string | null }) {
  const secondsLeft = useSecondsUntil(deadlineAt);
  return (
    <div className="flex flex-col items-center gap-space-sm rounded-xl bg-surface-container-lowest p-space-lg text-center">
      <span className="text-primary">
        <Spinner />
      </span>
      <p className="text-body-sm text-on-surface">
        Ждём код. Теперь войдите в App Store на iPhone с выданными данными и запросите код.
      </p>
      {deadlineAt && secondsLeft > 0 && <Countdown label="Ожидание ещё" seconds={secondsLeft} />}
    </div>
  );
}

type Props = {
  orderId: number;
  groupId: string;
  codesLeft: number;
};

/**
 * Turn on the wait first, then the buyer asks for the code on the iPhone; only a fresh code is shown,
 * and it is dropped from memory as soon as it expires.
 */
export function LoginCodeBox({ orderId, groupId, codesLeft }: Props) {
  const queryClient = useQueryClient();
  const [waitId, setWaitId] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);

  const start = useMutation({
    mutationFn: () => api.startCode(orderId, groupId),
    onSuccess: (wait) => {
      queryClient.setQueryData(queryKeys.codeWait(orderId, wait.id), wait);
      setIsStale(false);
      setWaitId(wait.id);
      // Starting a wait may shorten the delivery deadline.
      void queryClient.invalidateQueries({ queryKey: queryKeys.delivery(orderId) });
    },
    onError: () => hapticNotify('error'),
  });

  const status = useQuery({
    queryKey: queryKeys.codeWait(orderId, waitId ?? ''),
    queryFn: () => api.codeWait(orderId, waitId ?? ''),
    enabled: waitId !== null,
    refetchInterval: (query) => (query.state.data?.status === 'active' ? CODE_POLL_MS : false),
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  const wait: CodeWaitDto | undefined = waitId ? status.data : undefined;
  const codeSeconds = useSecondsUntil(wait?.codeExpiresAt ?? null);
  const hasFreshCode = wait?.status === 'succeeded' && wait.code !== null && codeSeconds > 0;
  const isCodeOver = wait?.status === 'succeeded' && codeSeconds === 0;

  // A finished code is removed from the screen and the query cache, not just hidden.
  useEffect(() => {
    if (!isCodeOver || !waitId) return;
    queryClient.removeQueries({ queryKey: queryKeys.codeWait(orderId, waitId) });
    setWaitId(null);
    setIsStale(true);
  }, [isCodeOver, waitId, orderId, queryClient]);

  const isSucceeded = wait?.status === 'succeeded';
  useEffect(() => {
    if (isSucceeded) hapticNotify('success');
  }, [isSucceeded]);

  // A cancelled wait means the account changed: re-read the delivery before anything else.
  const isCancelled = wait?.status === 'cancelled';
  useEffect(() => {
    if (isCancelled) void queryClient.invalidateQueries({ queryKey: queryKeys.delivery(orderId) });
  }, [isCancelled, orderId, queryClient]);

  const isWaiting = wait?.status === 'active';
  const finished: FinishedStatus | 'stale' | null =
    wait && wait.status !== 'active' && wait.status !== 'succeeded' ? wait.status : isStale ? 'stale' : null;
  const canStart = !isWaiting && !hasFreshCode;
  const isOutOfCodes = codesLeft <= 0;
  const error = start.error ?? status.error;

  return (
    <div className="flex flex-col gap-space-sm">
      {!wait && !finished && (
        <p className="text-body-sm text-on-surface-variant">
          Сначала нажмите «Включить ожидание кода», затем войдите в App Store на iPhone. Код появится здесь.
        </p>
      )}
      {isWaiting && <Waiting deadlineAt={wait?.deadlineAt ?? null} />}
      <AnimatePresence mode="wait" initial={false}>
        {hasFreshCode && wait?.code && <CodeDisplay key={wait.id} code={wait.code} />}
      </AnimatePresence>
      {hasFreshCode && <Countdown label="Действует ещё" seconds={codeSeconds} />}
      {finished && (
        <p role="status" className="flex items-start gap-1.5 text-body-sm text-on-surface-variant">
          <Icon name="timer_off" className="mt-0.5 text-[16px]" />
          {FINISHED_TEXT[finished]}
        </p>
      )}
      {canStart && (
        <Button
          isFullWidth
          icon="sms"
          isLoading={start.isPending}
          disabled={isOutOfCodes}
          onClick={() => start.mutate()}
        >
          {isOutOfCodes ? 'Лимит кодов исчерпан' : 'Включить ожидание кода'}
        </Button>
      )}
      {isOutOfCodes && canStart && (
        <p className="text-body-sm text-on-surface-variant">Если нужен ещё один вход, напишите в поддержку.</p>
      )}
      {error && (
        <p role="alert" className="text-body-sm text-error">
          {errorMessage(error)}
        </p>
      )}
    </div>
  );
}
