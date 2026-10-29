import { formatAppCount, type PromoCheckDto } from '@istock/shared';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { api, errorMessage } from '../../lib/api';
import { hapticNotify } from '../../lib/telegram';

type Props = {
  applied: PromoCheckDto | null;
  itemCount: number;
  onApply: (promo: PromoCheckDto) => void;
  onClear: () => void;
};

function AppliedPromo({ applied, itemCount, onClear }: Omit<Props, 'onApply'> & { applied: PromoCheckDto }) {
  const isOverLimit = itemCount > applied.appsLeft;
  return (
    <>
      <div className="flex items-center gap-3 rounded-xl bg-surface-container p-3.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-success/10">
          <Icon name="sell" className="text-[20px] text-success" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-label-lg text-on-surface">{applied.code}</span>
          <span className="text-body-sm text-on-surface-variant">
            Можно оплатить ещё {formatAppCount(applied.appsLeft)}
          </span>
        </div>
        <button
          type="button"
          onClick={onClear}
          aria-label="Убрать промокод"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-outline hover:text-on-surface"
        >
          <Icon name="close" className="text-[20px]" />
        </button>
      </div>
      {isOverLimit && (
        <p role="status" className="mt-2 text-balance text-body-sm text-warning">
          {applied.appsLeft === 0
            ? 'Промокод уже использован полностью'
            : `По промокоду можно оплатить ещё ${formatAppCount(applied.appsLeft)}. Уберите лишние из корзины.`}
        </p>
      )}
    </>
  );
}

/** Shown while payments are open by promo code only: the buyer enters a code before paying. */
export function PromoCodeField({ applied, itemCount, onApply, onClear }: Props) {
  const [code, setCode] = useState('');
  const check = useMutation({
    mutationFn: (value: string) => api.checkPromo(value),
    onSuccess: (promo) => {
      setCode('');
      onApply(promo);
    },
    onError: () => hapticNotify('error'),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (code.trim()) check.mutate(code);
  };

  return (
    <section aria-labelledby="promo-heading">
      <h2 id="promo-heading" className="mb-2.5 px-1 text-label-lg text-on-surface">
        Промокод
      </h2>
      {applied ? (
        <AppliedPromo applied={applied} itemCount={itemCount} onClear={onClear} />
      ) : (
        <>
          <p className="mb-2.5 px-1 text-body-sm text-on-surface-variant">Сейчас оплата доступна только по промокоду.</p>
          <form onSubmit={submit} className="flex gap-2">
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              aria-label="Промокод"
              placeholder="Введите промокод"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={32}
              enterKeyHint="done"
              className="h-11 min-w-0 flex-1 rounded-xl bg-surface-container-high px-4 text-body-md uppercase text-on-surface placeholder:normal-case placeholder:text-outline focus:bg-surface-container-highest focus:outline-none focus:ring-2 focus:ring-primary-container/60"
            />
            <Button type="submit" variant="secondary" isLoading={check.isPending} disabled={!code.trim()}>
              Применить
            </Button>
          </form>
          {check.isError && (
            <p role="alert" className="mt-2 px-1 text-body-sm text-error">
              {errorMessage(check.error)}
            </p>
          )}
        </>
      )}
    </section>
  );
}
