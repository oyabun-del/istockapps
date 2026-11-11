import { PAID_STATUSES, type PaymentMethod } from '@istock/shared';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { SalesSummary } from '../../domain/models.js';
import { TOP_APPS_LIMIT } from '../../domain/stats-period.js';
import type { DateRange, StatsRepository } from '../repositories.js';

/** Orders paid for by a free promo code. */
const FREE_METHOD: PaymentMethod = 'PROMO';

/** Lower bound for "all time" in raw SQL, where an absent bound cannot be skipped. */
const EPOCH = new Date(0);

/**
 * Prisma keeps DateTime as UTC in a zoneless TIMESTAMP column. A zoneless UTC literal compares with it
 * directly; a Date parameter could be shifted by the database session's time zone.
 */
function utcTimestamp(date: Date): string {
  return date.toISOString().replace('Z', '');
}

/** Sales figures straight from the database: aggregates only, no orders are loaded (top apps: at most five rows). */
export class PrismaStatsRepository implements StatsRepository {
  constructor(private readonly db: PrismaClient) {}

  async summary(range: DateRange): Promise<SalesSummary> {
    const within = { gte: range.from ?? undefined, lt: range.to };
    const paid: Prisma.OrderWhereInput = { paidAt: within, status: { in: [...PAID_STATUSES] } };
    // Free orders were never sold: they are counted on their own and kept out of every sales figure.
    const real: Prisma.OrderWhereInput = { ...paid, isSandbox: false, paymentMethod: { not: FREE_METHOD } };
    const free: Prisma.OrderWhereInput = { ...paid, paymentMethod: FREE_METHOD };

    const [sales, sandbox, appsSold, buyers, promoOrders, createdOrders, refunds, newUsers, topApps, freeOrders, freeApps] =
      await Promise.all([
      this.db.order.aggregate({
        where: real,
        _count: { _all: true },
        _sum: { amountKopecks: true, discountKopecks: true },
      }),
      this.db.order.aggregate({
        where: { ...paid, isSandbox: true, paymentMethod: { not: FREE_METHOD } },
        _count: { _all: true },
        _sum: { amountKopecks: true },
      }),
      this.db.orderItem.count({ where: { order: real } }),
      this.countBuyers(range),
      this.db.order.count({ where: { ...real, promoCodeId: { not: null } } }),
      this.db.order.count({ where: { createdAt: within, paymentMethod: { not: FREE_METHOD } } }),
      // A refund is recorded once per order (refunded is final), so orders with that event are the refunds.
      this.db.order.aggregate({
        where: {
          isSandbox: false,
          paymentMethod: { not: FREE_METHOD },
          events: { some: { type: 'refunded', createdAt: within } },
        },
        _count: { _all: true },
        _sum: { amountKopecks: true },
      }),
      this.db.user.count({ where: { createdAt: within } }),
      this.db.orderItem.groupBy({
        by: ['appName'],
        where: { order: real },
        _count: { appName: true },
        orderBy: [{ _count: { appName: 'desc' } }, { appName: 'asc' }],
        take: TOP_APPS_LIMIT,
      }),
      this.db.order.count({ where: free }),
      this.db.orderItem.count({ where: { order: free } }),
    ]);

    return {
      paidOrders: sales._count._all,
      appsSold,
      revenueKopecks: sales._sum.amountKopecks ?? 0,
      discountKopecks: sales._sum.discountKopecks ?? 0,
      buyers,
      promoOrders,
      freeOrders,
      freeApps,
      sandboxOrders: sandbox._count._all,
      sandboxKopecks: sandbox._sum.amountKopecks ?? 0,
      createdOrders,
      refunds: refunds._count._all,
      refundedKopecks: refunds._sum.amountKopecks ?? 0,
      newUsers,
      topApps: topApps.map((row) => ({ name: row.appName, count: row._count.appName })),
    };
  }

  /** Prisma has no COUNT(DISTINCT); same filter as `real` in summary(). */
  private async countBuyers(range: DateRange): Promise<number> {
    const rows = await this.db.$queryRaw<Array<{ buyers: bigint }>>`
      SELECT COUNT(DISTINCT "userId") AS "buyers" FROM "Order"
      WHERE "paidAt" >= ${utcTimestamp(range.from ?? EPOCH)}::timestamp
        AND "paidAt" < ${utcTimestamp(range.to)}::timestamp
        AND "isSandbox" = false AND "paymentMethod" <> ${FREE_METHOD} AND "status" IN (${Prisma.join([...PAID_STATUSES])})`;
    return Number(rows[0]?.buyers ?? 0);
  }
}
