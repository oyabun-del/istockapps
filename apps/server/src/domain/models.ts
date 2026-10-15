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
  codeRequests: number;
  lastCodeAt: Date | null;
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
    | 'codeRequests'
    | 'lastCodeAt'
    | 'paidAt'
    | 'completedAt'
  >
>;

export interface Ticket {
  id: number;
  userId: number;
  orderId: number | null;
  message: string;
  createdAt: Date;
}

export type NewTicket = Pick<Ticket, 'userId' | 'orderId' | 'message'>;
