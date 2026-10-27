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
    ADMIN_IDS: adminIdsSchema,
    SUPPORT_USERNAME: usernameSchema,
    /** Terms of service page shown in the profile (e.g. a Telegraph article). */
    TERMS_URL: httpsUrl.optional(),

    DATABASE_URL: z.string().min(1),

    PAYMENT_PROVIDER: z.enum(['cispay', 'mock']),
    CISPAY_SHOP_ID: z.uuid().optional(),
    CISPAY_API_KEY: z.string().startsWith('cis_sec_').optional(),
    CISPAY_API_URL: httpsUrl.default('https://api.cispay.app'),
    /** Accept CISPAY sandbox payments as real ones. Always true outside production. */
    ALLOW_SANDBOX_PAYMENTS: z
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
    if (env.PAYMENT_PROVIDER === 'cispay' && (!env.CISPAY_SHOP_ID || !env.CISPAY_API_KEY)) {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENT_PROVIDER'],
        message: 'CISPAY_SHOP_ID and CISPAY_API_KEY are required when PAYMENT_PROVIDER=cispay',
      });
    }
    if (env.NODE_ENV === 'production' && env.PAYMENT_PROVIDER === 'mock') {
      ctx.addIssue({ code: 'custom', path: ['PAYMENT_PROVIDER'], message: 'Mock payments are not allowed in production' });
    }
    if (env.NODE_ENV === 'production') {
      for (const key of ['WEBAPP_URL', 'PUBLIC_URL'] as const) {
        if (!env[key].startsWith('https://')) {
          ctx.addIssue({ code: 'custom', path: [key], message: `${key} must use https in production` });
        }
      }
    }
    if (env.DEV_USER_ID !== undefined && (env.NODE_ENV === 'production' || env.PAYMENT_PROVIDER === 'cispay')) {
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

export function supportUrl(env: Pick<Env, 'SUPPORT_USERNAME'>): string {
  return `https://t.me/${env.SUPPORT_USERNAME}`;
}
