import type { PrismaClient, Order as OrderRow, User as UserRow } from '@prisma/client';
import type { OrderStatus, PaymentMethod } from '@istock/shared';
import type { NewOrder, NewTicket, Order, OrderPatch, Ticket, User } from '../../domain/models.js';
import type {
  OrderEventRepository,
  OrderRepository,
  Repositories,
  TicketRepository,
  UserRepository,
} from '../repositories.js';

function toUser(row: UserRow): User {
  return {
    id: Number(row.id),
    firstName: row.firstName,
    lastName: row.lastName,
    username: row.username,
    photoUrl: row.photoUrl,
  };
}

function toOrder(row: OrderRow): Order {
  return {
    id: row.id,
    paymentOrderId: row.paymentOrderId,
    userId: Number(row.userId),
    appId: row.appId,
    appName: row.appName,
    appIconUrl: row.appIconUrl,
    amountKopecks: row.amountKopecks,
    // Values are written only through the typed domain layer.
    paymentMethod: row.paymentMethod as PaymentMethod,
    status: row.status as OrderStatus,
    paymentId: row.paymentId,
    paymentUrl: row.paymentUrl,
    paymentSyncedAt: row.paymentSyncedAt,
    codeRequests: row.codeRequests,
    lastCodeAt: row.lastCodeAt,
    paidAt: row.paidAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
  };
}

class PrismaUserRepository implements UserRepository {
  constructor(private readonly db: PrismaClient) {}

  async upsert(user: User): Promise<User> {
    const data = {
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      photoUrl: user.photoUrl,
    };
    const row = await this.db.user.upsert({
      where: { id: BigInt(user.id) },
      create: { id: BigInt(user.id), ...data },
      update: data,
    });
    return toUser(row);
  }

  async findById(id: number): Promise<User | null> {
    const row = await this.db.user.findUnique({ where: { id: BigInt(id) } });
    return row ? toUser(row) : null;
  }
}

class PrismaOrderRepository implements OrderRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(order: NewOrder): Promise<Order> {
    const row = await this.db.order.create({ data: { ...order, userId: BigInt(order.userId) } });
    return toOrder(row);
  }

  async findById(id: number): Promise<Order | null> {
    const row = await this.db.order.findUnique({ where: { id } });
    return row ? toOrder(row) : null;
  }

  async findByPaymentOrderId(paymentOrderId: string): Promise<Order | null> {
    const row = await this.db.order.findUnique({ where: { paymentOrderId } });
    return row ? toOrder(row) : null;
  }

  async findPendingForApp(userId: number, appId: string, createdAfter: Date): Promise<Order | null> {
    const row = await this.db.order.findFirst({
      where: {
        userId: BigInt(userId),
        appId,
        status: 'awaiting_payment',
        paymentUrl: { not: null },
        createdAt: { gt: createdAfter },
      },
      orderBy: { createdAt: 'desc' },
    });
    return row ? toOrder(row) : null;
  }

  async listByUser(userId: number, limit: number): Promise<Order[]> {
    const rows = await this.db.order.findMany({
      where: { userId: BigInt(userId) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return rows.map(toOrder);
  }

  async update(id: number, patch: Omit<OrderPatch, 'status'>): Promise<Order> {
    return toOrder(await this.db.order.update({ where: { id }, data: patch }));
  }

  async transition(
    id: number,
    from: readonly OrderStatus[],
    patch: OrderPatch & { status: OrderStatus },
  ): Promise<Order | null> {
    const result = await this.db.order.updateMany({
      where: { id, status: { in: [...from] } },
      data: patch,
    });
    if (result.count === 0) return null;
    return this.findById(id);
  }

  async recordCodeRequest(id: number, expectedCount: number, at: Date): Promise<Order | null> {
    const result = await this.db.order.updateMany({
      where: { id, codeRequests: expectedCount },
      data: { codeRequests: expectedCount + 1, lastCodeAt: at },
    });
    if (result.count === 0) return null;
    return this.findById(id);
  }
}

class PrismaOrderEventRepository implements OrderEventRepository {
  constructor(private readonly db: PrismaClient) {}

  async add(orderId: number, type: string, data?: Record<string, unknown>): Promise<void> {
    await this.db.orderEvent.create({
      data: { orderId, type, data: data ? JSON.stringify(data) : null },
    });
  }

  async has(orderId: number, type: string): Promise<boolean> {
    return (await this.db.orderEvent.count({ where: { orderId, type } })) > 0;
  }
}

class PrismaTicketRepository implements TicketRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(ticket: NewTicket): Promise<Ticket> {
    const row = await this.db.ticket.create({
      data: { ...ticket, userId: BigInt(ticket.userId) },
    });
    return { ...row, userId: Number(row.userId) };
  }

  async countByUserSince(userId: number, since: Date): Promise<number> {
    return this.db.ticket.count({ where: { userId: BigInt(userId), createdAt: { gte: since } } });
  }
}

export function createPrismaRepositories(db: PrismaClient): Repositories {
  return {
    users: new PrismaUserRepository(db),
    orders: new PrismaOrderRepository(db),
    orderEvents: new PrismaOrderEventRepository(db),
    tickets: new PrismaTicketRepository(db),
  };
}
