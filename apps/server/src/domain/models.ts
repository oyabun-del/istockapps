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
  /** Paid with a CISPAY test payment; kept out of revenue. */
  isSandbox: boolean;
  /** The promo code the order was let through with (payments open by promo code only). */
  promoCodeId: number | null;
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
> &
  Partial<Pick<Order, 'promoCodeId'>>;

export type OrderPatch = Partial<
  Pick<
    Order,
    | 'status'
    | 'paymentId'
    | 'paymentUrl'
    | 'paymentSyncedAt'
    | 'isSandbox'
    | 'deliveryRef'
    | 'deliveryExpiresAt'
    | 'codeReceivedAt'
    | 'paidAt'
    | 'completedAt'
  >
>;

/** Lets a buyer pay while payments are open by promo code only. */
export interface PromoCode {
  id: number;
  /** Upper case, matches PROMO_CODE_PATTERN. */
  code: string;
  /** Apps the code covers in total, across all buyers and orders. */
  maxApps: number;
  /** Admin who created the code. */
  createdBy: number;
  disabledAt: Date | null;
  createdAt: Date;
}

export type NewPromoCode = Pick<PromoCode, 'code' | 'maxApps' | 'createdBy'>;

/** Sales of a period; revenue figures leave out test payments, which are counted on their own. */
export interface SalesSummary {
  /** Orders paid in the period and not refunded. */
  paidOrders: number;
  appsSold: number;
  revenueKopecks: number;
  discountKopecks: number;
  buyers: number;
  /** Of paidOrders: let through by a promo code. */
  promoOrders: number;
  sandboxOrders: number;
  sandboxKopecks: number;
  /** Orders opened in the period, whatever happened to them. */
  createdOrders: number;
  /** Refunds made in the period (the order may have been paid earlier). */
  refunds: number;
  refundedKopecks: number;
  newUsers: number;
  /** Best sellers, most sold first. */
  topApps: Array<{ name: string; count: number }>;
}

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

/** An inline keyboard button. Broadcasts carry only url and web_app ones; callback buttons are the admin's controls. */
export type InlineButton =
  | { kind: 'url'; text: string; url: string }
  | { kind: 'web_app'; text: string; url: string }
  | { kind: 'callback'; text: string; data: string };

export type BroadcastButton = Exclude<InlineButton, { kind: 'callback' }>;

/** Rows of buttons; an empty list means no keyboard. */
export type Keyboard<T extends InlineButton = InlineButton> = readonly (readonly T[])[];

/**
 * awaiting_content → draft ⇄ awaiting_buttons → sending → done.
 * cancelled and failed are final too; failed means the source message is gone.
 */
export type BroadcastStatus =
  | 'awaiting_content'
  | 'awaiting_buttons'
  | 'draft'
  | 'sending'
  | 'done'
  | 'cancelled'
  | 'failed';

/** The admin's message that every user receives a copy of. */
export interface MessageRef {
  chatId: number;
  messageId: number;
}

export interface BroadcastCounters {
  sent: number;
  /** The user blocked the bot or deleted the account. */
  blocked: number;
  failed: number;
}

export interface Broadcast extends BroadcastCounters {
  id: number;
  authorId: number;
  status: BroadcastStatus;
  /** null until the admin sends the message. */
  source: MessageRef | null;
  buttons: Keyboard<BroadcastButton>;
  progressMessageId: number | null;
  /** Last user id handled; sending resumes after it. */
  cursorUserId: number | null;
  /** Recipients counted when sending started. */
  total: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}

export type BroadcastPatch = Partial<
  Pick<
    Broadcast,
    | 'status'
    | 'source'
    | 'buttons'
    | 'progressMessageId'
    | 'cursorUserId'
    | 'total'
    | 'sent'
    | 'blocked'
    | 'failed'
    | 'startedAt'
    | 'finishedAt'
  >
>;
