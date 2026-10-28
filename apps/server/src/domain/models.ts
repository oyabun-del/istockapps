import type { OrderStatus, PaymentMethod } from '@istock/shared';

export interface User {
  id: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
}

/** One app of an order, priced when the order was created. */
export interface OrderItem {
  appId: string;
  appName: string;
  appIconUrl: string;
  priceKopecks: number;
  discountKopecks: number;
}

export interface Order {
  id: number;
  paymentOrderId: string;
  userId: number;
  /** At least one app, in the order the buyer added them. */
  items: OrderItem[];
  /** Sum of app prices before the bulk discount. */
  subtotalKopecks: number;
  discountKopecks: number;
  /** What the buyer pays (subtotal minus discount); checked against the payment. */
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
  /** The buyer received a login code (or said Apple did not ask for one); unlocks the last step. */
  codeReceivedAt: Date | null;
  paidAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

export type NewOrder = Pick<
  Order,
  | 'paymentOrderId'
  | 'userId'
  | 'items'
  | 'subtotalKopecks'
  | 'discountKopecks'
  | 'amountKopecks'
  | 'paymentMethod'
  | 'status'
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
    | 'codeReceivedAt'
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
