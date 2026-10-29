import { useEffect, useState } from 'react';
import { copyText } from '../../lib/clipboard';
import { hapticNotify } from '../../lib/telegram';
import { Icon } from './Icon';

const COPIED_RESET_MS = 1800;

type Props = {
  label: string;
  value: string;
  isSecret?: boolean;
};

export function CopyField({ label, value, isSecret = false }: Props) {
  const [isCopied, setIsCopied] = useState(false);
  const [isRevealed, setIsRevealed] = useState(!isSecret);

  useEffect(() => {
    if (!isCopied) return undefined;
    const timer = setTimeout(() => setIsCopied(false), COPIED_RESET_MS);
    return () => clearTimeout(timer);
  }, [isCopied]);

  const handleCopy = async () => {
    const isOk = await copyText(value);
    setIsCopied(isOk);
    hapticNotify(isOk ? 'success' : 'error');
  };

  const shown = isRevealed ? value : '•'.repeat(Math.min(value.length, 12));

  return (
    <div className="flex items-center gap-2 rounded-lg bg-surface-container-lowest px-3 py-2.5 ring-1 ring-white/5">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-label-sm uppercase text-outline">{label}</span>
        <span className="tabular font-mono text-[14px] leading-5 text-on-surface [overflow-wrap:anywhere]" data-testid={`copy-${label}`}>
          {shown}
        </span>
      </div>
      {isSecret && (
        <button
          type="button"
          onClick={() => setIsRevealed((value) => !value)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high"
          aria-label={isRevealed ? 'Скрыть' : 'Показать'}
        >
          <Icon name={isRevealed ? 'visibility_off' : 'visibility'} className="text-[20px]" />
        </button>
      )}
      <button
        type="button"
        onClick={handleCopy}
        className={`flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-surface-container-high px-3 text-label-lg transition-[color,transform] active:scale-95 ${
          isCopied ? 'text-success' : 'text-on-surface'
        }`}
        aria-label={isCopied ? `${label} скопирован` : `Скопировать: ${label}`}
      >
        <Icon name={isCopied ? 'check' : 'content_copy'} className="text-[18px]" />
        <span aria-hidden="true">{isCopied ? 'Готово' : 'Копировать'}</span>
      </button>
    </div>
  );
}
