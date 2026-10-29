import { Prisma, type PrismaClient, type PromoCode as PromoCodeRow } from '@prisma/client';
import type { NewPromoCode, PromoCode } from '../../domain/models.js';
import type { PromoCodeRepository, SettingRepository } from '../repositories.js';

/** Unique constraint violation. */
const PRISMA_UNIQUE_VIOLATION = 'P2002';

export class PrismaSettingRepository implements SettingRepository {
  constructor(private readonly db: PrismaClient) {}

  async get(key: string): Promise<string | null> {
    const row = await this.db.setting.findUnique({ where: { key } });
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }

  async compareAndSet(key: string, expected: string | null, value: string): Promise<boolean> {
    if (expected === null) {
      const created = await this.db.setting.createMany({ data: [{ key, value }], skipDuplicates: true });
      return created.count === 1;
    }
    const updated = await this.db.setting.updateMany({ where: { key, value: expected }, data: { value } });
    return updated.count === 1;
  }
}

function toPromoCode(row: PromoCodeRow): PromoCode {
  return {
    id: row.id,
    code: row.code,
    maxApps: row.maxApps,
    createdBy: Number(row.createdBy),
    disabledAt: row.disabledAt,
    createdAt: row.createdAt,
  };
}

export class PrismaPromoCodeRepository implements PromoCodeRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(promo: NewPromoCode): Promise<PromoCode | null> {
    try {
      const row = await this.db.promoCode.create({ data: { ...promo, createdBy: BigInt(promo.createdBy) } });
      return toPromoCode(row);
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === PRISMA_UNIQUE_VIOLATION) return null;
      throw error;
    }
  }

  async findByCode(code: string): Promise<PromoCode | null> {
    const row = await this.db.promoCode.findUnique({ where: { code } });
    return row ? toPromoCode(row) : null;
  }

  async list(): Promise<PromoCode[]> {
    const rows = await this.db.promoCode.findMany({ orderBy: { id: 'desc' } });
    return rows.map(toPromoCode);
  }

  async disable(code: string, at: Date): Promise<PromoCode | null> {
    await this.db.promoCode.updateMany({ where: { code, disabledAt: null }, data: { disabledAt: at } });
    return this.findByCode(code);
  }
}
