import type { DeliveryDto } from '@istock/shared';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/ui/Icon';
import { RULES_CONSEQUENCE } from '../../content/delivery-rules';
import { useDeadline } from '../../hooks/useSecondsUntil';
import { formatCountdown, formatDuration } from '../../lib/format';

/** Under half an hour the timer turns red: the buyer should finish now. */
const URGENT_SECONDS = 30 * 60;

type Props = {
  delivery: DeliveryDto;
  /** Re-reads the delivery once the time is up: the server decides what is expired. */
  onExpire: () => void;
};

/**
 * Time left on the whole order. Before the first code request it is the time to download and sign
 * in; the first request shortens the order, so from then on it is the time to finish activation.
 */
export function DeliveryDeadline({ delivery, onExpire }: Props) {
  const { secondsLeft, isExpired } = useDeadline(delivery.expiresAt, onExpire);
  const isActivating = delivery.activationStartedAt !== null;
  const label = isActivating ? 'На активацию осталось' : 'На скачивание и вход осталось';
  const tone = isExpired || secondsLeft <= URGENT_SECONDS ? 'text-error' : 'text-on-surface';
  const activationSeconds = delivery.limits?.activationSeconds;

  return (
    <section
      aria-label="Срок выдачи"
      className="flex flex-col gap-space-sm rounded-xl bg-surface-container p-space-md ring-1 ring-warning/30"
    >
      {isExpired ? (
        <p role="status" className="flex items-center gap-1.5 text-label-lg text-error">
          <Icon name="timer_off" className="text-[20px]" />
          Срок выдачи истёк
        </p>
      ) : (
        <div className="flex items-center justify-between gap-space-sm">
          <span className="text-body-sm text-on-surface-variant">{label}</span>
          <span role="timer" className={`tabular flex items-center gap-1.5 text-headline-sm transition-colors ${tone}`}>
            <Icon name="schedule" className="text-[20px] text-warning" />
            {formatCountdown(secondsLeft)}
          </span>
        </div>
      )}
      {!isActivating && !isExpired && activationSeconds !== undefined && (
        <p className="text-body-sm text-on-surface-variant">
          {`После первого запроса кода на завершение останется ${formatDuration(activationSeconds)}.`}
        </p>
      )}
      <p className="flex items-start gap-1.5 text-body-sm text-warning">
        <Icon name="warning" className="mt-0.5 text-[16px]" />
        <span>
          Проходите шаги по порядку, ничего не пропуская. {RULES_CONSEQUENCE}{' '}
          <Link to="/guide" className="underline underline-offset-2">
            Инструкция
          </Link>
        </span>
      </p>
    </section>
  );
}
