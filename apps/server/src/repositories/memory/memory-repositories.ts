import type { OrderStatus } from '@istock/shared';
import type { NewOrder, NewTicket, Order, OrderPatch, Ticket, User } from '../../domain/models.js';
import type {
  OrderEventRepository,
  OrderRepository,
  Repositories,
  TicketRepository,
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
      codeRequests: 0,
      lastCodeAt: null,
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

  async recordCodeRequest(id: number, expectedCount: number, at: Date): Promise<Order | null> {
    const current = this.orders.get(id);
    if (!current || current.codeRequests !== expectedCount) return null;
    const updated = { ...current, codeRequests: expectedCount + 1, lastCodeAt: at };
    this.orders.set(id, updated);
    return { ...updated };
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

class MemoryTicketRepository implements TicketRepository {
  private readonly tickets: Ticket[] = [];

  constructor(private readonly now: Now) {}

  async create(input: NewTicket): Promise<Ticket> {
    const ticket: Ticket = { ...input, id: this.tickets.length + 1, createdAt: this.now() };
    this.tickets.push(ticket);
    return { ...ticket };
  }

  async countByUserSince(userId: number, since: Date): Promise<number> {
    return this.tickets.filter((item) => item.userId === userId && item.createdAt >= since).length;
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
    tickets: new MemoryTicketRepository(now),
  };
}
