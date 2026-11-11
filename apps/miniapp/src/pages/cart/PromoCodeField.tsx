import { formatAppCount, type PromoCheckDto } from '@istock/shared';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { api, errorMessage } from '../../lib/api';
import { hapticNotify } from '../../lib/telegram';

/** Payments modes the field is shown in; while payments are closed no code helps. */
export type PromoFieldMode = 'open' | 'promo';

type Props = {
  mode: PromoFieldMode;
  applied: PromoCheckDto | null;
  itemCount: number;
  onApply: (promo: PromoCheckDto) => void;
  onClear: () => void;
};

const ACCESS_CODE_NOT_NEEDED = 'Этот промокод нужен, только когда оплата открыта по промокоду. Сейчас оплатить можно и без промокода.';

function limitWarning(applied: PromoCheckDto): string {
  if (applied.appsLeft === 0) return 'Промокод уже использован полностью';
  const verb = applied.isFree ? 'получить' : 'оплатить';
  return `По промокоду можно ${verb} ещё ${formatAppCount(applied.appsLeft)}. Уберите лишние из корзины.`;
}

function AppliedPromo({ applied, itemCount, onClear }: Pick<Props, 'itemCount' | 'onClear'> & { applied: PromoCheckDto }) {
  const isOverLimit = itemCount > applied.appsLeft;
  const coverage = applied.isFree
    ? `Бесплатно: до ${formatAppCount(applied.appsLeft)}`
    : `Можно оплатить ещё ${formatAppCount(applied.appsLeft)}`;
  return (
    <>
      <div className="flex items-center gap-3 rounded-xl bg-surface-container p-3.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-success/10">
          <Icon name="sell" className="text-[20px] text-success" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-label-lg text-on-surface">{applied.code}</span>
          <span className="text-body-sm text-on-surface-variant">{coverage}</span>
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
          {limitWarning(applied)}
        </p>
      )}
    </>
  );
}

function PromoForm({ mode, onApply }: Pick<Props, 'mode' | 'onApply'>) {
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const check = useMutation({
    mutationFn: (value: string) => api.checkPromo(value),
    onSuccess: (promo) => {
      setCode('');
      // While payments are open to everyone only a free code changes anything.
      if (mode === 'open' && !promo.isFree) {
        setNotice(ACCESS_CODE_NOT_NEEDED);
        return;
      }
      onApply(promo);
    },
    onError: () => hapticNotify('error'),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setNotice(null);
    if (code.trim()) check.mutate(code);
  };

  return (
    <>
      {mode === 'promo' && (
        <p className="mb-2.5 px-1 text-body-sm text-on-surface-variant">Сейчас оплата доступна только по промокоду.</p>
      )}
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
          autoFocus={mode === 'open'}
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
      {notice && (
        <p role="status" className="mt-2 px-1 text-balance text-body-sm text-on-surface-variant">
          {notice}
        </p>
      )}
    </>
  );
}

/**
 * Promo code of the cart. While payments are open by promo code only it is required and shown at once;
 * while they are open to everyone it is tucked behind a link, since only a free code matters then.
 */
export function PromoCodeField({ mode, applied, itemCount, onApply, onClear }: Props) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!applied && !isExpanded && mode === 'open') {
    return (
      <button
        type="button"
        onClick={() => setIsExpanded(true)}
        className="self-start px-1 text-label-lg text-primary underline-offset-2 hover:underline"
      >
        Есть промокод?
      </button>
    );
  }

  return (
    <section aria-labelledby="promo-heading">
      <h2 id="promo-heading" className="mb-2.5 px-1 text-label-lg text-on-surface">
        Промокод
      </h2>
      {applied ? (
        <AppliedPromo applied={applied} itemCount={itemCount} onClear={onClear} />
      ) : (
        <PromoForm mode={mode} onApply={onApply} />
      )}
    </section>
  );
}
