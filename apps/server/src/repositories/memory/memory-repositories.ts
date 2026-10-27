import type { OrderStatus } from '@istock/shared';
import type { CodeWaitAttempt, NewCodeWaitAttempt, NewOrder, Order, OrderPatch, User } from '../../domain/models.js';
import type {
  CodeWaitAttemptRepository,
  OrderEventRepository,
  OrderRepository,
  Repositories,
  UserRepository,
} from '../repositories.js';

/** In-memory repositories for tests and quick local experiments. */
class MemoryUserRepository implements UserRepository {
  private readonly users = new Map<number, User>();

  async upsert(user: User): Promise<User> {
    this.users.set(user.id, { ...user });
    return { ...user };
  }

  async findById(id: number): Promise<User | null> {
    const user = this.users.get(id);
    return user ? { ...user } : null;
  }
}

type Now = () => Date;

class MemoryOrderRepository implements OrderRepository {
  private readonly orders = new Map<number, Order>();
  private nextId = 1;

  constructor(private readonly now: Now) {}

  async create(input: NewOrder): Promise<Order> {
    const order: Order = {
      ...input,
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
    this.orders.set(order.id, order);
    return { ...order };
  }

  async findById(id: number): Promise<Order | null> {
    const order = this.orders.get(id);
    return order ? { ...order } : null;
  }

  async findByPaymentOrderId(paymentOrderId: string): Promise<Order | null> {
    const order = [...this.orders.values()].find((item) => item.paymentOrderId === paymentOrderId);
    return order ? { ...order } : null;
  }

  async findPendingForApp(userId: number, appId: string, createdAfter: Date): Promise<Order | null> {
    const order = [...this.orders.values()]
      .filter(
        (item) =>
          item.userId === userId &&
          item.appId === appId &&
          item.status === 'awaiting_payment' &&
          item.paymentUrl !== null &&
          item.createdAt > createdAfter,
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return order ? { ...order } : null;
  }

  async listByUser(userId: number, limit: number): Promise<Order[]> {
    return [...this.orders.values()]
      .filter((item) => item.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id)
      .slice(0, limit)
      .map((item) => ({ ...item }));
  }

  async update(id: number, patch: Omit<OrderPatch, 'status'>): Promise<Order> {
    const current = this.orders.get(id);
    if (!current) throw new Error(`Order ${id} not found`);
    const updated = { ...current, ...patch };
    this.orders.set(id, updated);
    return { ...updated };
  }

  async transition(
    id: number,
    from: readonly OrderStatus[],
    patch: OrderPatch & { status: OrderStatus },
  ): Promise<Order | null> {
    const current = this.orders.get(id);
    if (!current || !from.includes(current.status)) return null;
    const updated = { ...current, ...patch };
    this.orders.set(id, updated);
    return { ...updated };
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

export interface MemoryRepositories extends Repositories {
  orderEvents: MemoryOrderEventRepository;
}

export function createMemoryRepositories(now: Now = () => new Date()): MemoryRepositories {
  return {
    users: new MemoryUserRepository(),
    orders: new MemoryOrderRepository(now),
    orderEvents: new MemoryOrderEventRepository(),
    codeWaits: new MemoryCodeWaitAttemptRepository(now),
  };
}
