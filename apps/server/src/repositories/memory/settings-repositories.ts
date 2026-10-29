import { isPaidStatus } from '@istock/shared';
import type { NewPromoCode, Order, PromoCode, SalesSummary } from '../../domain/models.js';
import { TOP_APPS_LIMIT } from '../../domain/stats-period.js';
import type { DateRange, PromoCodeRepository, SettingRepository, StatsRepository } from '../repositories.js';

type Now = () => Date;

export class MemorySettingRepository implements SettingRepository {
  private readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async compareAndSet(key: string, expected: string | null, value: string): Promise<boolean> {
    if ((this.values.get(key) ?? null) !== expected) return false;
    this.values.set(key, value);
    return true;
  }
}

export class MemoryPromoCodeRepository implements PromoCodeRepository {
  private codes: readonly PromoCode[] = [];

  constructor(private readonly now: Now) {}

  async create(input: NewPromoCode): Promise<PromoCode | null> {
    if (this.codes.some((item) => item.code === input.code)) return null;
    const promo: PromoCode = { ...input, id: this.codes.length + 1, disabledAt: null, createdAt: this.now() };
    this.codes = [...this.codes, promo];
    return { ...promo };
  }

  async findByCode(code: string): Promise<PromoCode | null> {
    const found = this.codes.find((item) => item.code === code);
    return found ? { ...found } : null;
  }

  async list(): Promise<PromoCode[]> {
    return [...this.codes].reverse().map((item) => ({ ...item }));
  }

  async disable(code: string, at: Date): Promise<PromoCode | null> {
    this.codes = this.codes.map((item) => (item.code === code && !item.disabledAt ? { ...item, disabledAt: at } : item));
    return this.findByCode(code);
  }
}

export interface MemoryStatsSources {
  orders: () => Order[];
  events: () => ReadonlyArray<{ orderId: number; type: string; createdAt: Date }>;
  userCreationDates: () => Date[];
}

function isWithin(date: Date | null, range: DateRange): boolean {
  if (!date) return false;
  return (range.from === null || date >= range.from) && date < range.to;
}

function sumOf(orders: readonly Order[], pick: (order: Order) => number): number {
  return orders.reduce((total, order) => total + pick(order), 0);
}

function topApps(orders: readonly Order[]): SalesSummary['topApps'] {
  const counts = new Map<string, number>();
  for (const item of orders.flatMap((order) => order.items)) {
    counts.set(item.appName, (counts.get(item.appName) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, TOP_APPS_LIMIT);
}

/** Same figures as PrismaStatsRepository, computed over the other memory repositories. */
export class MemoryStatsRepository implements StatsRepository {
  constructor(private readonly sources: MemoryStatsSources) {}

  async summary(range: DateRange): Promise<SalesSummary> {
    const orders = this.sources.orders();
    const paid = orders.filter((order) => isPaidStatus(order.status) && isWithin(order.paidAt, range));
    const real = paid.filter((order) => !order.isSandbox);
    const sandbox = paid.filter((order) => order.isSandbox);
    const byId = new Map(orders.map((order) => [order.id, order]));
    const refunded = this.sources
      .events()
      .filter((event) => event.type === 'refunded' && isWithin(event.createdAt, range))
      .map((event) => byId.get(event.orderId))
      .filter((order): order is Order => order !== undefined && !order.isSandbox);

    return {
      paidOrders: real.length,
      appsSold: sumOf(real, (order) => order.items.length),
      revenueKopecks: sumOf(real, (order) => order.amountKopecks),
      discountKopecks: sumOf(real, (order) => order.discountKopecks),
      buyers: new Set(real.map((order) => order.userId)).size,
      promoOrders: real.filter((order) => order.promoCodeId !== null).length,
      sandboxOrders: sandbox.length,
      sandboxKopecks: sumOf(sandbox, (order) => order.amountKopecks),
      createdOrders: orders.filter((order) => isWithin(order.createdAt, range)).length,
      refunds: refunded.length,
      refundedKopecks: sumOf(refunded, (order) => order.amountKopecks),
      newUsers: this.sources.userCreationDates().filter((date) => isWithin(date, range)).length,
      topApps: topApps(real),
    };
  }
}
