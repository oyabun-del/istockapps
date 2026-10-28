import { Icon } from '../../components/ui/Icon';
import { Skeleton } from '../../components/ui/StateViews';
import { PAYMENT_METHOD_META } from '../../lib/order-status';

type Props = {
  isAvailable: boolean;
  isLoading: boolean;
  error: string | null;
};

const SBP = PAYMENT_METHOD_META.SBP;

/** The only payment method: SBP through the buyer's bank app. */
export function SbpPaymentRow({ isAvailable, isLoading, error }: Props) {
  return (
    <section aria-labelledby="payment-heading">
      <h2 id="payment-heading" className="mb-2.5 px-1 text-label-lg text-on-surface">
        Способ оплаты
      </h2>
      {isLoading && <Skeleton className="h-[64px]" />}
      {error && <p className="text-body-sm text-error">{error}</p>}
      {!isLoading && !error && !isAvailable && (
        <p className="text-body-sm text-on-surface-variant">Оплата временно недоступна. Попробуйте позже.</p>
      )}
      {isAvailable && (
        <div className="flex items-center gap-3 rounded-xl bg-surface-container p-3.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-container-high">
            <Icon name={SBP.icon} className={`text-[22px] ${SBP.iconClass}`} />
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="text-label-lg text-on-surface">{SBP.label}</span>
            <span className="text-body-sm text-on-surface-variant">Оплата в приложении вашего банка</span>
          </div>
        </div>
      )}
    </section>
  );
}
