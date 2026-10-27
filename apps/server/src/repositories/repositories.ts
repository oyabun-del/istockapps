import type { OrderStatus } from '@istock/shared';
import type {
  CodeWaitAttempt,
  NewCodeWaitAttempt,
  NewOrder,
  NewTicket,
  Order,
  OrderPatch,
  Ticket,
  User,
} from '../domain/models.js';

export interface UserRepository {
  upsert(user: User): Promise<User>;
  findById(id: number): Promise<User | null>;
}

export interface OrderRepository {
  create(order: NewOrder): Promise<Order>;
  findById(id: number): Promise<Order | null>;
  findByPaymentOrderId(paymentOrderId: string): Promise<Order | null>;
  findPendingForApp(userId: number, appId: string, createdAfter: Date): Promise<Order | null>;
  listByUser(userId: number, limit: number): Promise<Order[]>;
  /** Unconditional field update (never changes status). */
  update(id: number, patch: Omit<OrderPatch, 'status'>): Promise<Order>;
  /**
   * Atomic compare-and-set: applies `patch` only if the current status is one of `from`.
   * Returns the updated order, or null if the status did not match (concurrent change).
   */
  transition(id: number, from: readonly OrderStatus[], patch: OrderPatch & { status: OrderStatus }): Promise<Order | null>;
}

export interface CodeWaitAttemptRepository {
  create(attempt: NewCodeWaitAttempt): Promise<CodeWaitAttempt>;
  /** Newest attempt for the group, or null. */
  findLatest(orderId: number, groupId: string): Promise<CodeWaitAttempt | null>;
  findByWaitId(orderId: number, waitId: string): Promise<CodeWaitAttempt | null>;
  setWaitId(id: number, waitId: string): Promise<void>;
}

export interface OrderEventRepository {
  add(orderId: number, type: string, data?: Record<string, unknown>): Promise<void>;
  has(orderId: number, type: string): Promise<boolean>;
}

export interface TicketRepository {
  create(ticket: NewTicket): Promise<Ticket>;
  countByUserSince(userId: number, since: Date): Promise<number>;
}

export interface Repositories {
  users: UserRepository;
  orders: OrderRepository;
  orderEvents: OrderEventRepository;
  codeWaits: CodeWaitAttemptRepository;
  tickets: TicketRepository;
}
