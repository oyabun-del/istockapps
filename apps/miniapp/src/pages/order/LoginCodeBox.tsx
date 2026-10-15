import type { CodeDto } from '@istock/shared';
import { useMutation } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { api, errorMessage } from '../../lib/api';
import { copyText } from '../../lib/clipboard';
import { REVEAL } from '../../lib/motion';
import { hapticNotify } from '../../lib/telegram';

const TICK_MS = 1000;

function secondsUntil(iso: string, now: number): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / TICK_MS));
}

function useSecondsLeft(until: string | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!until) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [until]);

  return until ? secondsUntil(until, now) : 0;
}

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

type Props = {
  orderId: number;
};

export function LoginCodeBox({ orderId }: Props) {
  const [code, setCode] = useState<CodeDto | null>(null);
  const secondsLeft = useSecondsLeft(code?.nextRequestAt ?? null);

  const request = useMutation({
    mutationFn: () => api.code(orderId),
    onSuccess: (result) => {
      hapticNotify('success');
      setCode(result);
    },
    onError: () => hapticNotify('error'),
  });

  const label = code ? (secondsLeft > 0 ? `Новый код через ${secondsLeft} с` : 'Запросить новый код') : 'Получить код';

  return (
    <div className="flex flex-col gap-space-sm">
      <p className="text-body-sm text-on-surface-variant">
        Когда iPhone попросит код подтверждения, нажмите кнопку, и код появится здесь.
      </p>
      <AnimatePresence mode="wait" initial={false}>
        {code && <CodeDisplay key={code.code} code={code.code} />}
      </AnimatePresence>
      <Button
        isFullWidth
        variant={code ? 'secondary' : 'primary'}
        icon="sms"
        isLoading={request.isPending}
        disabled={secondsLeft > 0}
        onClick={() => request.mutate()}
      >
        {label}
      </Button>
      {request.isError && (
        <p role="alert" className="text-body-sm text-error">
          {errorMessage(request.error)}
        </p>
      )}
    </div>
  );
}
