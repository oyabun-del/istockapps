import type { OrderStatus, PaymentMethod } from '@istock/shared';
import type { IconName } from './icons';

export type Tone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

export const ORDER_STATUS_META: Record<OrderStatus, { label: string; tone: Tone; icon: IconName }> = {
  awaiting_payment: { label: 'Ожидает оплаты', tone: 'warning', icon: 'schedule' },
  paid: { label: 'Оплачен', tone: 'info', icon: 'check_circle' },
  download_confirmed: { label: 'Скачано', tone: 'info', icon: 'download_done' },
  credentials_issued: { label: 'Активация', tone: 'info', icon: 'key' },
  completed: { label: 'Активировано', tone: 'success', icon: 'verified' },
  failed: { label: 'Оплата не прошла', tone: 'danger', icon: 'error' },
  expired: { label: 'Счёт истёк', tone: 'neutral', icon: 'timer_off' },
  cancelled: { label: 'Отменён', tone: 'neutral', icon: 'cancel' },
  refunded: { label: 'Возврат', tone: 'neutral', icon: 'undo' },
};

type PaymentMethodMeta = { label: string; payLabel: string; icon: IconName; iconClass: string };

export const PAYMENT_METHOD_META: Record<PaymentMethod, PaymentMethodMeta> = {
  SBP: { label: 'СБП', payLabel: 'Оплатить через СБП', icon: 'qr_code_2', iconClass: 'text-secondary' },
  CARD: { label: 'Карта РФ', payLabel: 'Оплатить картой', icon: 'credit_card', iconClass: 'text-primary' },
  CRYPTO: { label: 'USDT', payLabel: 'Оплатить в USDT', icon: 'currency_bitcoin', iconClass: 'text-success' },
};
