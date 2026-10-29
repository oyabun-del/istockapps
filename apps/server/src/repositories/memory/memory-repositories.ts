import type { OrderStatus } from '@istock/shared';
import { DRAFT_STATUSES } from '../../domain/broadcast-status.js';
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
} from '../../domain/models.js';
import type {
  BroadcastRepository,
  CodeWaitAttemptRepository,
  OrderEventRepository,
  OrderRepository,
  Repositories,
  UserRepository,
} from '../repositories.js';

/** In-memory repositories for tests and quick local experiments. */
class MemoryUserRepository implements UserRepository {
  private readonly users = new Map<number, User>();
  private readonly blockedAt = new Map<number, Date>();

  async upsert(user: User): Promise<User> {
    this.users.set(user.id, { ...user });
    return { ...user };
  }

  async findById(id: number): Promise<User | null> {
    const user = this.users.get(id);
    return user ? { ...user } : null;
  }

  async listRecipients(afterId: number | null, limit: number): Promise<number[]> {
    return this.recipientIds()
      .filter((id) => afterId === null || id > afterId)
      .slice(0, limit);
  }

  async countRecipients(): Promise<number> {
    return this.recipientIds().length;
  }

  async setBotBlockedAt(id: number, at: Date | null): Promise<void> {
    if (at) this.blockedAt.set(id, at);
    else this.blockedAt.delete(id);
  }

  private recipientIds(): number[] {
    return [...this.users.keys()].filter((id) => !this.blockedAt.has(id)).sort((a, b) => a - b);
  }
}

type Now = () => Date;

/** Callers get their own copy, items included, like rows read from the database. */
function copyOrder(order: Order): Order {
  return { ...order, items: order.items.map((item) => ({ ...item })) };
}

/** Prisma skips `undefined` fields of an update instead of clearing them. */
function definedFields<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<T>;
}

/** Same unique columns as the Order table. */
const UNIQUE_ORDER_FIELDS = ['paymentOrderId', 'paymentId', 'deliveryRef'] as const;

class MemoryOrderRepository implements OrderRepository {
  private readonly orders = new Map<number, Order>();
  private nextId = 1;

  constructor(private readonly now: Now) {}

  async create(input: NewOrder): Promise<Order> {
    const order: Order = {
      ...input,
      items: input.items.map((item) => ({ ...item })),
      id: this.nextId++,
      paymentId: null,
      paymentUrl: null,
      paymentSyncedAt: null,
      deliveryRef: null,
      deliveryExpiresAt: null,
      codeReceivedAt: null,
      paidAt: null,
      completedAt: null,
      createdAt: this.now(),
    };
    this.save(order);
    return copyOrder(order);
  }

  async findById(id: number): Promise<Order | null> {
    const order = this.orders.get(id);
    return order ? copyOrder(order) : null;
  }

  async findByPaymentOrderId(paymentOrderId: string): Promise<Order | null> {
    const order = [...this.orders.values()].find((item) => item.paymentOrderId === paymentOrderId);
    return order ? copyOrder(order) : null;
  }

  async findPendingForApps(userId: number, appIds: readonly string[], createdAfter: Date): Promise<Order | null> {
    const wanted = new Set(appIds);
    const order = [...this.orders.values()]
      .filter(
        (item) =>
          item.userId === userId &&
          item.items.length === appIds.length &&
          item.items.every((orderItem) => wanted.has(orderItem.appId)) &&
          item.status === 'awaiting_payment' &&
          item.paymentUrl !== null &&
          item.createdAt > createdAfter,
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return order ? copyOrder(order) : null;
  }

  async listByUser(userId: number, limit: number): Promise<Order[]> {
    return [...this.orders.values()]
      .filter((item) => item.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id)
      .slice(0, limit)
      .map(copyOrder);
  }

  async listForPaymentSync(statuses: readonly OrderStatus[], createdAfter: Date, limit: number): Promise<Order[]> {
    return [...this.orders.values()]
      .filter((item) => statuses.includes(item.status) && item.paymentId !== null && item.createdAt > createdAfter)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id)
      .slice(0, limit)
      .map(copyOrder);
  }

  async update(id: number, patch: Omit<OrderPatch, 'status'>): Promise<Order> {
    const current = this.orders.get(id);
    if (!current) throw new Error(`Order ${id} not found`);
    const updated = { ...current, ...definedFields(patch) };
    this.save(updated);
    return copyOrder(updated);
  }

  async markCodeReceived(id: number, at: Date): Promise<Order | null> {
    const current = this.orders.get(id);
    if (!current || current.codeReceivedAt) return null;
    const updated = { ...current, codeReceivedAt: at };
    this.save(updated);
    return copyOrder(updated);
  }

  async transition(
    id: number,
    from: readonly OrderStatus[],
    patch: OrderPatch & { status: OrderStatus },
  ): Promise<Order | null> {
    const current = this.orders.get(id);
    if (!current || !from.includes(current.status)) return null;
    const updated = { ...current, ...definedFields(patch) };
    this.save(updated);
    return copyOrder(updated);
  }

  private save(order: Order): void {
    for (const field of UNIQUE_ORDER_FIELDS) {
      const value = order[field];
      const isTaken =
        value !== null && [...this.orders.values()].some((item) => item.id !== order.id && item[field] === value);
      if (isTaken) throw new Error(`Unique constraint failed on Order.${field}`);
    }
    this.orders.set(order.id, order);
  }
}

class MemoryCodeWaitAttemptRepository implements CodeWaitAttemptRepository {
  private attempts: readonly CodeWaitAttempt[] = [];

  constructor(private readonly now: Now) {}

  async create(input: NewCodeWaitAttempt): Promise<CodeWaitAttempt> {
    if (this.attempts.some((item) => item.idempotencyKey === input.idempotencyKey)) {
      throw new Error('Duplicate idempotency key');
    }
    const attempt: CodeWaitAttempt = { ...input, id: this.attempts.length + 1, waitId: null, createdAt: this.now() };
    this.attempts = [...this.attempts, attempt];
    return { ...attempt };
  }

  async findLatest(orderId: number, groupId: string): Promise<CodeWaitAttempt | null> {
    const found = this.attempts.filter((item) => item.orderId === orderId && item.groupId === groupId).at(-1);
    return found ? { ...found } : null;
  }

  async findByWaitId(orderId: number, waitId: string): Promise<CodeWaitAttempt | null> {
    const found = this.attempts.find((item) => item.orderId === orderId && item.waitId === waitId);
    return found ? { ...found } : null;
  }

  async setWaitId(id: number, waitId: string): Promise<void> {
    this.attempts = this.attempts.map((item) => (item.id === id ? { ...item, waitId } : item));
  }
}

class MemoryOrderEventRepository implements OrderEventRepository {
  readonly events: Array<{ orderId: number; type: string; data?: Record<string, unknown> }> = [];

  async add(orderId: number, type: string, data?: Record<string, unknown>): Promise<void> {
    this.events.push({ orderId, type, data });
  }

  async has(orderId: number, type: string): Promise<boolean> {
    return this.events.some((event) => event.orderId === orderId && event.type === type);
  }
}

class MemoryBroadcastRepository implements BroadcastRepository {
  private readonly broadcasts = new Map<number, Broadcast>();
  private nextId = 1;

  constructor(private readonly now: Now) {}

  async create(authorId: number): Promise<Broadcast> {
    const broadcast: Broadcast = {
      id: this.nextId++,
      authorId,
      status: 'awaiting_content',
      source: null,
      buttons: [],
      progressMessageId: null,
      cursorUserId: null,
      total: 0,
      sent: 0,
      blocked: 0,
      failed: 0,
      startedAt: null,
      finishedAt: null,
      createdAt: this.now(),
    };
    this.broadcasts.set(broadcast.id, broadcast);
    return { ...broadcast };
  }

  async findById(id: number): Promise<Broadcast | null> {
    const broadcast = this.broadcasts.get(id);
    return broadcast ? { ...broadcast } : null;
  }

  async findOpenDraft(authorId: number): Promise<Broadcast | null> {
    const found = [...this.broadcasts.values()]
      .filter((item) => item.authorId === authorId && DRAFT_STATUSES.includes(item.status))
      .at(-1);
    return found ? { ...found } : null;
  }

  async listByStatus(status: BroadcastStatus): Promise<Broadcast[]> {
    return [...this.broadcasts.values()].filter((item) => item.status === status).map((item) => ({ ...item }));
  }

  async update(id: number, patch: Omit<BroadcastPatch, 'status'>): Promise<Broadcast> {
    const current = this.broadcasts.get(id);
    if (!current) throw new Error(`Broadcast ${id} not found`);
    const updated = { ...current, ...patch };
    this.broadcasts.set(id, updated);
    return { ...updated };
  }

  async transition(
    id: number,
    from: readonly BroadcastStatus[],
    patch: BroadcastPatch & { status: BroadcastStatus },
  ): Promise<Broadcast | null> {
    const current = this.broadcasts.get(id);
    if (!current || !from.includes(current.status)) return null;
    const updated = { ...current, ...patch };
    this.broadcasts.set(id, updated);
    return { ...updated };
  }
}

export interface MemoryRepositories extends Repositories {
  orderEvents: MemoryOrderEventRepository;
}

export function createMemoryRepositories(now: Now = () => new Date()): MemoryRepositories {
  return {
    users: new MemoryUserRepository(),
    orders: new MemoryOrderRepository(now),
    orderEvents: new MemoryOrderEventRepository(),
    codeWaits: new MemoryCodeWaitAttemptRepository(now),
    broadcasts: new MemoryBroadcastRepository(now),
  };
}
