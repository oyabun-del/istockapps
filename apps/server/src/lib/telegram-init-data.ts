import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/** initData older than this is rejected (replay protection). */
export const INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60;
/** Tolerated clock skew for auth_date in the future. */
const MAX_CLOCK_SKEW_SECONDS = 60;

const telegramUserSchema = z.object({
  id: z.number().int().positive(),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().optional(),
  language_code: z.string().optional(),
});

export interface TelegramUser {
  id: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
}

export interface ValidatedInitData {
  user: TelegramUser;
  authDate: number;
  startParam: string | null;
}

export type InitDataResult = { ok: true; data: ValidatedInitData } | { ok: false; reason: string };

/**
 * Validates Mini App initData per
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateInitData(
  initData: string,
  botToken: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): InitDataResult {
  if (!initData) return { ok: false, reason: 'empty' };

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return { ok: false, reason: 'missing hash' };

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secretKey).update(dataCheckString).digest();
  const actual = Buffer.from(hash, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { ok: false, reason: 'bad signature' };
  }

  const authDate = Number(params.get('auth_date'));
  if (!Number.isInteger(authDate) || authDate <= 0) return { ok: false, reason: 'bad auth_date' };
  if (nowSeconds - authDate > INIT_DATA_MAX_AGE_SECONDS) return { ok: false, reason: 'expired' };
  if (authDate - nowSeconds > MAX_CLOCK_SKEW_SECONDS) return { ok: false, reason: 'auth_date in future' };

  const rawUser = params.get('user');
  if (!rawUser) return { ok: false, reason: 'missing user' };

  let parsedUser: unknown;
  try {
    parsedUser = JSON.parse(rawUser);
  } catch {
    return { ok: false, reason: 'bad user json' };
  }
  const user = telegramUserSchema.safeParse(parsedUser);
  if (!user.success) return { ok: false, reason: 'bad user' };

  return {
    ok: true,
    data: {
      authDate,
      startParam: params.get('start_param'),
      user: {
        id: user.data.id,
        firstName: user.data.first_name,
        lastName: user.data.last_name ?? null,
        username: user.data.username ?? null,
        photoUrl: user.data.photo_url ?? null,
      },
    },
  };
}

/** Offline mode has no bot token; a random secret makes every forged initData signature fail. */
export function initDataSecret(botToken: string | undefined): string {
  return botToken ?? randomBytes(32).toString('hex');
}

/** Test helper / dev tool: builds a correctly signed initData string. */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const dataCheckString = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}
