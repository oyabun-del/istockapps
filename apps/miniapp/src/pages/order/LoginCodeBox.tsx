import type { CodeDto } from '@istock/shared';
import { useMutation } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { useSecondsUntil } from '../../hooks/useSecondsUntil';
import { api, errorMessage } from '../../lib/api';
import { copyText } from '../../lib/clipboard';
import { formatCountdown } from '../../lib/format';
import { REVEAL } from '../../lib/motion';
import { hapticNotify } from '../../lib/telegram';

function CodeDisplay({ code, isExpired }: { code: string; isExpired: boolean }) {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = async () => {
    const isOk = await copyText(code);
    setIsCopied(isOk);
    hapticNotify(isOk ? 'success' : 'error');
  };

  const codeTone = isExpired ? 'text-outline line-through' : 'text-on-surface';
  return (
    <motion.button
      {...REVEAL}
      type="button"
      onClick={handleCopy}
      aria-label={`Код ${code}. Нажмите, чтобы скопировать`}
      className="flex flex-col items-center gap-1 rounded-xl bg-surface-container-lowest p-space-lg ring-1 ring-primary-container/40 transition-transform active:scale-[0.98]"
    >
      <span className="text-label-sm uppercase text-outline">Код подтверждения</span>
      <span className={`tabular font-mono text-display tracking-[0.3em] transition-colors ${codeTone}`} aria-live="polite">
        {code}
      </span>
      <span className="flex items-center gap-1 text-label-md text-primary">
        <Icon name={isCopied ? 'check' : 'content_copy'} className="text-[16px]" />
        {isCopied ? 'Скопировано' : 'Нажмите, чтобы скопировать'}
      </span>
    </motion.button>
  );
}

/** Shown only when the delivery API says how long the code lives. */
function CodeExpiry({ secondsLeft }: { secondsLeft: number }) {
  if (secondsLeft === 0) {
    return (
      <p className="flex items-center justify-center gap-1.5 text-body-sm text-error">
        <Icon name="timer_off" className="text-[16px]" />
        Код истёк, запросите новый
      </p>
    );
  }
  return (
    <p role="timer" className="tabular flex items-center justify-center gap-1.5 text-label-md text-secondary">
      <Icon name="schedule" className="text-[16px]" />
      {`Действует ещё ${formatCountdown(secondsLeft)}`}
    </p>
  );
}

type Props = {
  orderId: number;
};

export function LoginCodeBox({ orderId }: Props) {
  const [code, setCode] = useState<CodeDto | null>(null);
  const secondsLeft = useSecondsUntil(code?.nextRequestAt ?? null);
  const expiresAt = code?.expiresAt ?? null;
  const validSeconds = useSecondsUntil(expiresAt);
  const isExpired = expiresAt !== null && validSeconds === 0;

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
        {code && <CodeDisplay key={code.code} code={code.code} isExpired={isExpired} />}
      </AnimatePresence>
      {expiresAt && <CodeExpiry secondsLeft={validSeconds} />}
      <Button
        isFullWidth
        variant={code && !isExpired ? 'secondary' : 'primary'}
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
