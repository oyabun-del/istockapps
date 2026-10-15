import type { OrderStatus, PaymentMethod } from '@istock/shared';

export type Tone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

export const ORDER_STATUS_META: Record<OrderStatus, { label: string; tone: Tone; icon: string }> = {
  awaiting_payment: { label: 'Ожидает оплаты', tone: 'warning', icon: 'schedule' },
  paid: { label: 'Оплачен', tone: 'info', icon: 'check_circle' },
  download_confirmed: { label: 'Скачано', tone: 'info', icon: 'download_done' },
  credentials_issued: { label: 'Активация', tone: 'info', icon: 'key' },
  completed: { label: 'Активировано', tone: 'success', icon: 'verified' },
  failed: { label: 'Оплата не прошла', tone: 'danger', icon: 'error' },
  expired: { label: 'Счёт истёк', tone: 'neutral', icon: 'timer_off' },
  refunded: { label: 'Возврат', tone: 'neutral', icon: 'undo' },
};

export const PAYMENT_METHOD_META: Record<PaymentMethod, { label: string; icon: string; iconClass: string }> = {
  SBP: { label: 'СБП', icon: 'qr_code_2', iconClass: 'text-secondary' },
  CARD: { label: 'Карта РФ', icon: 'credit_card', iconClass: 'text-primary' },
  CRYPTO: { label: 'USDT', icon: 'currency_bitcoin', iconClass: 'text-success' },
};
