import type { OrderStatus } from '@istock/shared';
import type {
  Broadcast,
  BroadcastPatch,
  BroadcastStatus,
  CodeWaitAttempt,
  NewCodeWaitAttempt,
  NewOrder,
  Order,
  OrderPatch,
  User,
} from '../domain/models.js';

export interface UserRepository {
  upsert(user: User): Promise<User>;
  findById(id: number): Promise<User | null>;
  /** Ids of users the bot can still write to, ascending, after `afterId` (null = from the start). */
  listRecipients(afterId: number | null, limit: number): Promise<number[]>;
  countRecipients(): Promise<number>;
  /** `at` = when a message failed with 403; null when the user started the bot again. */
  setBotBlockedAt(id: number, at: Date | null): Promise<void>;
}

export interface OrderRepository {
  create(order: NewOrder): Promise<Order>;
  findById(id: number): Promise<Order | null>;
  findByPaymentOrderId(paymentOrderId: string): Promise<Order | null>;
  /** Newest unpaid order with a payment link for exactly this set of apps (order of ids does not matter). */
  findPendingForApps(userId: number, appIds: readonly string[], createdAfter: Date): Promise<Order | null>;
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

export interface BroadcastRepository {
  create(authorId: number): Promise<Broadcast>;
  findById(id: number): Promise<Broadcast | null>;
  /** The author's broadcast that is still being prepared, or null. */
  findOpenDraft(authorId: number): Promise<Broadcast | null>;
  /** Oldest first. */
  listByStatus(status: BroadcastStatus): Promise<Broadcast[]>;
  /** Unconditional field update (never changes status). */
  update(id: number, patch: Omit<BroadcastPatch, 'status'>): Promise<Broadcast>;
  /** Atomic compare-and-set, like OrderRepository.transition. */
  transition(
    id: number,
    from: readonly BroadcastStatus[],
    patch: BroadcastPatch & { status: BroadcastStatus },
  ): Promise<Broadcast | null>;
}

export interface Repositories {
  users: UserRepository;
  orders: OrderRepository;
  orderEvents: OrderEventRepository;
  codeWaits: CodeWaitAttemptRepository;
  broadcasts: BroadcastRepository;
}
