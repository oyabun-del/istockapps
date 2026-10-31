import { z } from 'zod';

const TELEGRAM_ID = /^-?\d+$/;

/** "123, 456" → [123, 456]. Each admin must have pressed /start in the bot to receive messages. */
const adminIdsSchema = z
  .string()
  .trim()
  .min(1, 'ADMIN_IDS must contain at least one Telegram user id')
  .transform((raw, ctx) => {
    const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
    const invalid = parts.filter((part) => !TELEGRAM_ID.test(part));
    if (invalid.length > 0) {
      ctx.addIssue({ code: 'custom', message: `Invalid admin ids: ${invalid.join(', ')}` });
      return z.NEVER;
    }
    return [...new Set(parts.map(Number))];
  });

/** "@channel" or "-100123..." */
const channelSchema = z
  .string()
  .trim()
  .regex(/^(@[A-Za-z0-9_]{4,}|-100\d+)$/, 'REQUIRED_CHANNEL must be @username or -100… id');

const usernameSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/^@/, ''))
  .pipe(z.string().regex(/^[A-Za-z0-9_]{4,}$/, 'Expected Telegram username'));

const httpsUrl = z.url({ protocol: /^https$/ });

const SELLER_KEYS = ['SELLER_NAME', 'SELLER_EMAIL'] as const;

const MAX_PRICE_RUB = 1_000_000;
const rublesSchema = z.coerce.number().positive().max(MAX_PRICE_RUB).multipleOf(0.01);

/** JSON object of app id → price in rubles. */
const pricesSchema = z
  .string()
  .trim()
  .transform((raw, ctx) => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'INSTALLIOS_PRICES must be a JSON object like {"app_x": 299}' });
      return z.NEVER;
    }
  })
  .pipe(z.record(z.string().min(1), z.number().positive().max(MAX_PRICE_RUB).multipleOf(0.01)));
/** IANA zone such as Europe/Moscow; checked against the runtime's time zone data. */
const timeZoneSchema = z
  .string()
  .trim()
  .refine((zone) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  }, 'STATS_TIME_ZONE must be an IANA time zone, e.g. Europe/Moscow');

/** "23:55" → { hour: 23, minute: 55 }. */
const timeOfDaySchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'DAILY_REPORT_TIME must be HH:MM, e.g. 23:55')
  .transform((value) => {
    const [hour = 0, minute = 0] = value.split(':').map(Number);
    return { hour, minute };
  });

const MAX_BROADCAST_RATE = 30;
const DEFAULT_BROADCAST_RATE = 25;

/** http is allowed outside production (local dev); production is checked in superRefine. */
const webUrl = z.url({ protocol: /^https?$/ });

const envSchema = z
  .object({
    // Safe default: a forgotten NODE_ENV keeps every production guard on.
    NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().default('0.0.0.0'),
    /** Number of reverse proxies in front of the app (0 = trust no X-Forwarded-For). */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    /** Required unless TELEGRAM_OFFLINE=true (checked in superRefine). */
    BOT_TOKEN: z.string().regex(/^\d+:[\w-]{30,}$/, 'BOT_TOKEN looks invalid').optional(),
    BOT_USERNAME: usernameSchema.optional(),
    WEBAPP_URL: webUrl,
    PUBLIC_URL: webUrl,

    REQUIRED_CHANNEL: channelSchema,
    REQUIRED_CHANNEL_URL: httpsUrl.optional(),
    /** False: anyone may use the shop; REQUIRED_CHANNEL is then only the channel link in the profile. */
    REQUIRE_CHANNEL_SUBSCRIPTION: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    ADMIN_IDS: adminIdsSchema,
    SUPPORT_USERNAME: usernameSchema,
    /** How the terms and privacy policy name the seller; required in production (checked in superRefine). */
    SELLER_NAME: z.string().trim().min(1).optional(),
    /** Where buyers send personal data requests. */
    SELLER_EMAIL: z.email().optional(),
    /** Broadcast copies per second; Telegram allows about 30 for bulk messages. */
    BROADCAST_RATE_PER_SEC: z.coerce.number().int().min(1).max(MAX_BROADCAST_RATE).default(DEFAULT_BROADCAST_RATE),
    /** Days of the sales stats and of the daily report are counted in this zone. */
    STATS_TIME_ZONE: timeZoneSchema.default('Europe/Moscow'),
    /** When the admins get the day's sales, in STATS_TIME_ZONE. */
    DAILY_REPORT_TIME: z.string().default('23:55').pipe(timeOfDaySchema),

    DATABASE_URL: z.string().min(1),

    PAYMENT_PROVIDER: z.enum(['platega', 'mock']),
    PLATEGA_MERCHANT_ID: z.uuid().optional(),
    /** API key; server-to-server only, never sent to the Mini App. */
    PLATEGA_SECRET: z.string().trim().min(1).optional(),
    PLATEGA_API_URL: httpsUrl.default('https://app.platega.io'),
    /**
     * Production without Platega: PAYMENT_PROVIDER=mock is refused unless this is true. Real apps are
     * then handed out by promo code only (see CheckoutGate.isOpenModeAllowed).
     */
    ALLOW_MOCK_PAYMENTS: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),

    CATALOG_PROVIDER: z.enum(['mock', 'installios']).default('mock'),
    DELIVERY_PROVIDER: z.enum(['mock', 'installios']).default('mock'),
    INSTALLIOS_API_BASE: httpsUrl.default('https://api.installios.ru/v1'),
    /** Partner key; server-to-server only, never sent to the Mini App. */
    INSTALLIOS_API_KEY: z.string().trim().min(16, 'INSTALLIOS_API_KEY looks too short').optional(),
    /** Price of every Install-IOS app in rubles, unless INSTALLIOS_PRICES overrides it. */
    INSTALLIOS_DEFAULT_PRICE_RUB: rublesSchema.optional(),
    /** Per-app prices in rubles: {"app_…": 299}. */
    INSTALLIOS_PRICES: pricesSchema.default({}),

    /** Development only: lets the Mini App work in a regular browser without Telegram initData. */
    DEV_USER_ID: z.coerce.number().int().positive().optional(),
    SERVE_MINIAPP: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    /** Development only: run without a bot. Everyone counts as subscribed, notifications go to the log. */
    TELEGRAM_OFFLINE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
  })
  .superRefine((env, ctx) => {
    if (!env.TELEGRAM_OFFLINE && !env.BOT_TOKEN) {
      ctx.addIssue({ code: 'custom', path: ['BOT_TOKEN'], message: 'BOT_TOKEN is required (or TELEGRAM_OFFLINE=true in development)' });
    }
    if (env.TELEGRAM_OFFLINE && (env.NODE_ENV !== 'development' || env.PAYMENT_PROVIDER !== 'mock')) {
      ctx.addIssue({
        code: 'custom',
        path: ['TELEGRAM_OFFLINE'],
        message: 'TELEGRAM_OFFLINE is allowed only with NODE_ENV=development and PAYMENT_PROVIDER=mock',
      });
    }
    if (env.TELEGRAM_OFFLINE && env.DEV_USER_ID === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['DEV_USER_ID'],
        message: 'TELEGRAM_OFFLINE requires DEV_USER_ID: without a bot nobody can sign in through Telegram',
      });
    }
    if (env.PAYMENT_PROVIDER === 'platega' && (!env.PLATEGA_MERCHANT_ID || !env.PLATEGA_SECRET)) {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENT_PROVIDER'],
        message: 'PLATEGA_MERCHANT_ID and PLATEGA_SECRET are required when PAYMENT_PROVIDER=platega',
      });
    }
    if (env.NODE_ENV === 'production' && env.PAYMENT_PROVIDER === 'mock' && !env.ALLOW_MOCK_PAYMENTS) {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENT_PROVIDER'],
        message: 'Mock payments are not allowed in production (ALLOW_MOCK_PAYMENTS=true hands out apps by promo code only)',
      });
    }
    if (env.NODE_ENV === 'production') {
      for (const key of ['WEBAPP_URL', 'PUBLIC_URL'] as const) {
        if (!env[key].startsWith('https://')) {
          ctx.addIssue({ code: 'custom', path: [key], message: `${key} must use https in production` });
        }
      }
    }
    if (env.DEV_USER_ID !== undefined && (env.NODE_ENV === 'production' || env.PAYMENT_PROVIDER === 'platega')) {
      ctx.addIssue({
        code: 'custom',
        path: ['DEV_USER_ID'],
        message: 'DEV_USER_ID is allowed only in development with mock payments',
      });
    }
    if (env.NODE_ENV === 'production' && (env.CATALOG_PROVIDER === 'mock' || env.DELIVERY_PROVIDER === 'mock')) {
      ctx.addIssue({
        code: 'custom',
        path: ['DELIVERY_PROVIDER'],
        message: 'Mock catalog/delivery would hand out fake credentials; connect the real API before production',
      });
    }
    const usesInstallios = env.CATALOG_PROVIDER === 'installios' || env.DELIVERY_PROVIDER === 'installios';
    if (usesInstallios && !env.INSTALLIOS_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['INSTALLIOS_API_KEY'],
        message: 'INSTALLIOS_API_KEY is required when CATALOG_PROVIDER or DELIVERY_PROVIDER is installios',
      });
    }
    if (env.CATALOG_PROVIDER === 'installios' && env.INSTALLIOS_DEFAULT_PRICE_RUB === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['INSTALLIOS_DEFAULT_PRICE_RUB'],
        message: 'INSTALLIOS_DEFAULT_PRICE_RUB is required: Install-IOS does not send prices',
      });
    }
    if (env.CATALOG_PROVIDER !== env.DELIVERY_PROVIDER) {
      ctx.addIssue({
        code: 'custom',
        path: ['DELIVERY_PROVIDER'],
        message: 'CATALOG_PROVIDER and DELIVERY_PROVIDER must match: app ids of one are unknown to the other',
      });
    }
    const missingSeller = SELLER_KEYS.filter((key) => !env[key]);
    const isSellerPartial = missingSeller.length > 0 && missingSeller.length < SELLER_KEYS.length;
    if (env.NODE_ENV === 'production' || isSellerPartial) {
      for (const key of missingSeller) {
        ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required: the legal documents name the seller` });
      }
    }
    if (env.REQUIRED_CHANNEL.startsWith('-100') && !env.REQUIRED_CHANNEL_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['REQUIRED_CHANNEL_URL'],
        message: 'REQUIRED_CHANNEL_URL is required when REQUIRED_CHANNEL is a numeric id',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return result.data;
}

export function channelUrl(env: Pick<Env, 'REQUIRED_CHANNEL' | 'REQUIRED_CHANNEL_URL'>): string {
  if (env.REQUIRED_CHANNEL_URL) return env.REQUIRED_CHANNEL_URL;
  return `https://t.me/${env.REQUIRED_CHANNEL.replace(/^@/, '')}`;
}

const KOPECKS_PER_RUBLE = 100;

/** Price in kopecks of an Install-IOS app: its override, else the default price. */
export function installiosPriceOf(
  env: Pick<Env, 'INSTALLIOS_DEFAULT_PRICE_RUB' | 'INSTALLIOS_PRICES'>,
): (appId: string) => number {
  const fallback = env.INSTALLIOS_DEFAULT_PRICE_RUB;
  if (fallback === undefined) throw new Error('INSTALLIOS_DEFAULT_PRICE_RUB is not set');
  return (appId) => Math.round((env.INSTALLIOS_PRICES[appId] ?? fallback) * KOPECKS_PER_RUBLE);
}

export interface Seller {
  name: string;
  email: string;
}

/** How the documents name the seller, or null when not configured (development only, see superRefine). */
export function sellerOf(env: Pick<Env, (typeof SELLER_KEYS)[number]>): Seller | null {
  const { SELLER_NAME: name, SELLER_EMAIL: email } = env;
  if (!name || !email) return null;
  return { name, email };
}

export function supportUrl(env: Pick<Env, 'SUPPORT_USERNAME'>): string {
  return `https://t.me/${env.SUPPORT_USERNAME}`;
}
