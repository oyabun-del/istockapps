import type { Broadcast as BroadcastRow, Prisma, PrismaClient, User as UserRow } from '@prisma/client';
import type { OrderStatus, PaymentMethod } from '@istock/shared';
import { DRAFT_STATUSES } from '../../domain/broadcast-status.js';
import type {
  Broadcast,
  BroadcastButton,
  BroadcastPatch,
  BroadcastStatus,
  CodeWaitAttempt,
  Keyboard,
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

function toUser(row: UserRow): User {
  return {
    id: Number(row.id),
    firstName: row.firstName,
    lastName: row.lastName,
    username: row.username,
    photoUrl: row.photoUrl,
  };
}

/** Every order read carries its items, in the order they were added. */
const WITH_ITEMS = { items: { orderBy: { id: 'asc' } } } satisfies Prisma.OrderInclude;
type OrderRow = Prisma.OrderGetPayload<{ include: typeof WITH_ITEMS }>;

/** Unpaid orders a user can have at once is small; this only bounds the lookup. */
const PENDING_LOOKUP_LIMIT = 20;

function toOrder(row: OrderRow): Order {
  return {
    id: row.id,
    paymentOrderId: row.paymentOrderId,
    userId: Number(row.userId),
    items: row.items.map((item) => ({
      appId: item.appId,
      appName: item.appName,
      appIconUrl: item.appIconUrl,
      priceKopecks: item.priceKopecks,
      discountKopecks: item.discountKopecks,
    })),
    subtotalKopecks: row.subtotalKopecks,
    discountKopecks: row.discountKopecks,
    amountKopecks: row.amountKopecks,
    // Values are written only through the typed domain layer.
    paymentMethod: row.paymentMethod as PaymentMethod,
    status: row.status as OrderStatus,
    paymentId: row.paymentId,
    paymentUrl: row.paymentUrl,
    paymentSyncedAt: row.paymentSyncedAt,
    deliveryRef: row.deliveryRef,
    deliveryExpiresAt: row.deliveryExpiresAt,
    codeReceivedAt: row.codeReceivedAt,
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

  async listRecipients(afterId: number | null, limit: number): Promise<number[]> {
    const rows = await this.db.user.findMany({
      where: { botBlockedAt: null, ...(afterId === null ? {} : { id: { gt: BigInt(afterId) } }) },
      orderBy: { id: 'asc' },
      take: limit,
      select: { id: true },
    });
    return rows.map((row) => Number(row.id));
  }

  async countRecipients(): Promise<number> {
    return this.db.user.count({ where: { botBlockedAt: null } });
  }

  async setBotBlockedAt(id: number, at: Date | null): Promise<void> {
    // updateMany: a user unknown to the database is not an error here.
    await this.db.user.updateMany({ where: { id: BigInt(id) }, data: { botBlockedAt: at } });
  }
}

class PrismaOrderRepository implements OrderRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(order: NewOrder): Promise<Order> {
    const { items, ...fields } = order;
    const row = await this.db.order.create({
      data: { ...fields, userId: BigInt(order.userId), items: { create: items } },
      include: WITH_ITEMS,
    });
    return toOrder(row);
  }

  async findById(id: number): Promise<Order | null> {
    const row = await this.db.order.findUnique({ where: { id }, include: WITH_ITEMS });
    return row ? toOrder(row) : null;
  }

  async findByPaymentOrderId(paymentOrderId: string): Promise<Order | null> {
    const row = await this.db.order.findUnique({ where: { paymentOrderId }, include: WITH_ITEMS });
    return row ? toOrder(row) : null;
  }

  async findPendingForApps(userId: number, appIds: readonly string[], createdAfter: Date): Promise<Order | null> {
    // Every item is one of the wanted apps; (orderId, appId) is unique, so equal counts mean the same set.
    const rows = await this.db.order.findMany({
      where: {
        userId: BigInt(userId),
        status: 'awaiting_payment',
        paymentUrl: { not: null },
        createdAt: { gt: createdAfter },
        items: { every: { appId: { in: [...appIds] } } },
      },
      orderBy: { createdAt: 'desc' },
      take: PENDING_LOOKUP_LIMIT,
      include: WITH_ITEMS,
    });
    const row = rows.find((candidate) => candidate.items.length === appIds.length);
    return row ? toOrder(row) : null;
  }

  async listByUser(userId: number, limit: number): Promise<Order[]> {
    const rows = await this.db.order.findMany({
      where: { userId: BigInt(userId) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      include: WITH_ITEMS,
    });
    return rows.map(toOrder);
  }

  async update(id: number, patch: Omit<OrderPatch, 'status'>): Promise<Order> {
    return toOrder(await this.db.order.update({ where: { id }, data: patch, include: WITH_ITEMS }));
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
}

class PrismaCodeWaitAttemptRepository implements CodeWaitAttemptRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(attempt: NewCodeWaitAttempt): Promise<CodeWaitAttempt> {
    return this.db.codeWaitAttempt.create({ data: attempt });
  }

  async findLatest(orderId: number, groupId: string): Promise<CodeWaitAttempt | null> {
    return this.db.codeWaitAttempt.findFirst({ where: { orderId, groupId }, orderBy: { id: 'desc' } });
  }

  async findByWaitId(orderId: number, waitId: string): Promise<CodeWaitAttempt | null> {
    return this.db.codeWaitAttempt.findFirst({ where: { orderId, waitId } });
  }

  async setWaitId(id: number, waitId: string): Promise<void> {
    await this.db.codeWaitAttempt.update({ where: { id }, data: { waitId } });
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

function toBroadcast(row: BroadcastRow): Broadcast {
  return {
    id: row.id,
    authorId: Number(row.authorId),
    // Values are written only through the typed domain layer.
    status: row.status as BroadcastStatus,
    source:
      row.sourceChatId !== null && row.sourceMessageId !== null
        ? { chatId: Number(row.sourceChatId), messageId: row.sourceMessageId }
        : null,
    buttons: row.buttons as unknown as Keyboard<BroadcastButton>,
    progressMessageId: row.progressMessageId,
    cursorUserId: row.cursorUserId === null ? null : Number(row.cursorUserId),
    total: row.total,
    sent: row.sent,
    blocked: row.blocked,
    failed: row.failed,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
  };
}

function toBroadcastData(patch: BroadcastPatch): Prisma.BroadcastUpdateManyMutationInput {
  const { source, buttons, cursorUserId, ...fields } = patch;
  return {
    ...fields,
    ...(source === undefined
      ? {}
      : { sourceChatId: source ? BigInt(source.chatId) : null, sourceMessageId: source?.messageId ?? null }),
    ...(buttons === undefined ? {} : { buttons: buttons as unknown as Prisma.InputJsonValue }),
    ...(cursorUserId === undefined ? {} : { cursorUserId: cursorUserId === null ? null : BigInt(cursorUserId) }),
  };
}

class PrismaBroadcastRepository implements BroadcastRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(authorId: number): Promise<Broadcast> {
    return toBroadcast(await this.db.broadcast.create({ data: { authorId: BigInt(authorId), status: 'awaiting_content' } }));
  }

  async findById(id: number): Promise<Broadcast | null> {
    const row = await this.db.broadcast.findUnique({ where: { id } });
    return row ? toBroadcast(row) : null;
  }

  async findOpenDraft(authorId: number): Promise<Broadcast | null> {
    const row = await this.db.broadcast.findFirst({
      where: { authorId: BigInt(authorId), status: { in: [...DRAFT_STATUSES] } },
      orderBy: { id: 'desc' },
    });
    return row ? toBroadcast(row) : null;
  }

  async listByStatus(status: BroadcastStatus): Promise<Broadcast[]> {
    const rows = await this.db.broadcast.findMany({ where: { status }, orderBy: { id: 'asc' } });
    return rows.map(toBroadcast);
  }

  async update(id: number, patch: Omit<BroadcastPatch, 'status'>): Promise<Broadcast> {
    return toBroadcast(await this.db.broadcast.update({ where: { id }, data: toBroadcastData(patch) }));
  }

  async transition(
    id: number,
    from: readonly BroadcastStatus[],
    patch: BroadcastPatch & { status: BroadcastStatus },
  ): Promise<Broadcast | null> {
    const result = await this.db.broadcast.updateMany({
      where: { id, status: { in: [...from] } },
      data: toBroadcastData(patch),
    });
    if (result.count === 0) return null;
    return this.findById(id);
  }
}

export function createPrismaRepositories(db: PrismaClient): Repositories {
  return {
    users: new PrismaUserRepository(db),
    orders: new PrismaOrderRepository(db),
    orderEvents: new PrismaOrderEventRepository(db),
    codeWaits: new PrismaCodeWaitAttemptRepository(db),
    broadcasts: new PrismaBroadcastRepository(db),
  };
}
