import type { OrderStatus, PaymentMethod } from '@istock/shared';

export interface User {
  id: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
}

export interface Order {
  id: number;
  paymentOrderId: string;
  userId: number;
  appId: string;
  appName: string;
  appIconUrl: string;
  amountKopecks: number;
  paymentMethod: PaymentMethod;
  status: OrderStatus;
  paymentId: string | null;
  paymentUrl: string | null;
  paymentSyncedAt: Date | null;
  /** Order id in the delivery API; null until the delivery is created after payment. */
  deliveryRef: string | null;
  /** Last known delivery deadline from the delivery API. */
  deliveryExpiresAt: Date | null;
  paidAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

export type NewOrder = Pick<
  Order,
  'paymentOrderId' | 'userId' | 'appId' | 'appName' | 'appIconUrl' | 'amountKopecks' | 'paymentMethod' | 'status'
>;

export type OrderPatch = Partial<
  Pick<
    Order,
    | 'status'
    | 'paymentId'
    | 'paymentUrl'
    | 'paymentSyncedAt'
    | 'deliveryRef'
    | 'deliveryExpiresAt'
    | 'paidAt'
    | 'completedAt'
  >
>;

/** One explicit attempt to receive a login code. Holds no code, only ids to resume the attempt. */
export interface CodeWaitAttempt {
  id: number;
  orderId: number;
  groupId: string;
  /** Reused by network retries of this attempt so the API never starts a second wait. */
  idempotencyKey: string;
  /** Known once the API accepted the attempt. */
  waitId: string | null;
  createdAt: Date;
}

export type NewCodeWaitAttempt = Pick<CodeWaitAttempt, 'orderId' | 'groupId' | 'idempotencyKey'>;

export interface Ticket {
  id: number;
  userId: number;
  orderId: number | null;
  message: string;
  createdAt: Date;
}

export type NewTicket = Pick<Ticket, 'userId' | 'orderId' | 'message'>;
