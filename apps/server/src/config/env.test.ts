import { describe, expect, it } from 'vitest';
import { channelUrl, installiosPriceOf, parseEnv, sellerOf, supportUrl } from './env.js';

const BASE = {
  BOT_TOKEN: '123456:ABCdefGHIjklMNOpqrSTUvwxYZ0123456789',
  WEBAPP_URL: 'https://shop.example.com',
  PUBLIC_URL: 'https://shop.example.com',
  REQUIRED_CHANNEL: '@my_channel',
  ADMIN_IDS: '111, 222,111',
  SUPPORT_USERNAME: '@support_acc',
  DATABASE_URL: 'file:./dev.db',
  NODE_ENV: 'development',
  PAYMENT_PROVIDER: 'mock',
};

const SELLER = {
  SELLER_NAME: 'iStockApps',
  SELLER_EMAIL: 'shop@example.com',
};

describe('parseEnv', () => {
  it('parses a list of admins, dedupes and applies defaults', () => {
    const env = parseEnv(BASE);

    expect(env.ADMIN_IDS).toEqual([111, 222]);
    expect(env.SUPPORT_USERNAME).toBe('support_acc');
    expect(env.TRUST_PROXY_HOPS).toBe(0);
    expect(env.REQUIRE_CHANNEL_SUBSCRIPTION).toBe(true);
    expect(env.PORT).toBe(3000);
    expect(env.SERVE_MINIAPP).toBe(true);
    expect(env.BROADCAST_RATE_PER_SEC).toBe(25);
  });

  it('keeps the broadcast rate within Telegram limits', () => {
    expect(parseEnv({ ...BASE, BROADCAST_RATE_PER_SEC: '10' }).BROADCAST_RATE_PER_SEC).toBe(10);
    expect(() => parseEnv({ ...BASE, BROADCAST_RATE_PER_SEC: '50' })).toThrow(/BROADCAST_RATE_PER_SEC/);
    expect(() => parseEnv({ ...BASE, BROADCAST_RATE_PER_SEC: '0' })).toThrow(/BROADCAST_RATE_PER_SEC/);
  });

  it('counts stats days in Moscow and sends the daily report at 23:55 by default', () => {
    const env = parseEnv(BASE);

    expect(env.STATS_TIME_ZONE).toBe('Europe/Moscow');
    expect(env.DAILY_REPORT_TIME).toEqual({ hour: 23, minute: 55 });
  });

  it('accepts another time zone and report time, and rejects malformed ones', () => {
    const env = parseEnv({ ...BASE, STATS_TIME_ZONE: 'Asia/Yekaterinburg', DAILY_REPORT_TIME: '09:05' });

    expect(env.STATS_TIME_ZONE).toBe('Asia/Yekaterinburg');
    expect(env.DAILY_REPORT_TIME).toEqual({ hour: 9, minute: 5 });
    expect(() => parseEnv({ ...BASE, STATS_TIME_ZONE: 'Mars/Olympus' })).toThrow(/STATS_TIME_ZONE/);
    for (const time of ['24:00', '9:05', '23:60', 'noon']) {
      expect(() => parseEnv({ ...BASE, DAILY_REPORT_TIME: time })).toThrow(/DAILY_REPORT_TIME/);
    }
  });

  describe('TELEGRAM_OFFLINE', () => {
    const { BOT_TOKEN: _token, ...WITHOUT_TOKEN } = BASE;
    const OFFLINE = { ...WITHOUT_TOKEN, TELEGRAM_OFFLINE: 'true', DEV_USER_ID: '1' };

    it('lets development run without a bot token', () => {
      const env = parseEnv(OFFLINE);
      expect(env.TELEGRAM_OFFLINE).toBe(true);
      expect(env.BOT_TOKEN).toBeUndefined();
    });

    it('still requires a bot token when Telegram is online', () => {
      expect(() => parseEnv(WITHOUT_TOKEN)).toThrow(/BOT_TOKEN/);
    });

    it('needs DEV_USER_ID, because nobody can sign in through Telegram', () => {
      expect(() => parseEnv({ ...OFFLINE, DEV_USER_ID: undefined })).toThrow(/TELEGRAM_OFFLINE requires DEV_USER_ID/);
    });

    it('is refused in production and with real payments', () => {
      expect(() => parseEnv({ ...OFFLINE, NODE_ENV: 'production' })).toThrow(/TELEGRAM_OFFLINE/);
      expect(() =>
        parseEnv({
          ...OFFLINE,
          PAYMENT_PROVIDER: 'platega',
          PLATEGA_MERCHANT_ID: '0192a4b8-0000-7000-8000-000000000001',
          PLATEGA_SECRET: 'secret',
        }),
      ).toThrow(/TELEGRAM_OFFLINE/);
    });
  });

  it('rejects invalid admin ids with a readable message', () => {
    expect(() => parseEnv({ ...BASE, ADMIN_IDS: '111,abc' })).toThrow(/ADMIN_IDS: Invalid admin ids: abc/);
  });

  it('requires Platega credentials when the real provider is selected', () => {
    expect(() => parseEnv({ ...BASE, PAYMENT_PROVIDER: 'platega' })).toThrow(/PLATEGA_MERCHANT_ID and PLATEGA_SECRET/);
  });

  it('points at the Platega API by default', () => {
    const env = parseEnv({
      ...BASE,
      PAYMENT_PROVIDER: 'platega',
      PLATEGA_MERCHANT_ID: '0192a4b8-0000-7000-8000-000000000001',
      PLATEGA_SECRET: 'secret',
    });
    expect(env.PLATEGA_API_URL).toBe('https://app.platega.io');
  });

  it('no longer accepts CISPAY as a provider', () => {
    expect(() => parseEnv({ ...BASE, PAYMENT_PROVIDER: 'cispay' })).toThrow(/PAYMENT_PROVIDER/);
  });

  it('turns the channel subscription off only when asked explicitly', () => {
    expect(parseEnv({ ...BASE, REQUIRE_CHANNEL_SUBSCRIPTION: 'false' }).REQUIRE_CHANNEL_SUBSCRIPTION).toBe(false);
    expect(parseEnv({ ...BASE, REQUIRE_CHANNEL_SUBSCRIPTION: 'true' }).REQUIRE_CHANNEL_SUBSCRIPTION).toBe(true);
    expect(() => parseEnv({ ...BASE, REQUIRE_CHANNEL_SUBSCRIPTION: 'off' })).toThrow(/REQUIRE_CHANNEL_SUBSCRIPTION/);
  });

  it('forbids mock payments, mock delivery, dev user and plain http in production', () => {
    const run = () =>
      parseEnv({ ...BASE, NODE_ENV: 'production', DEV_USER_ID: '1', WEBAPP_URL: 'http://shop.example.com' });
    expect(run).toThrow(/Mock payments are not allowed/);
    expect(run).toThrow(/DEV_USER_ID is allowed only/);
    expect(run).toThrow(/WEBAPP_URL must use https/);
    expect(run).toThrow(/fake credentials/);
  });

  it('allows mock payments in production only when explicitly asked, never with a dev user', () => {
    const production = {
      ...BASE,
      ...SELLER,
      NODE_ENV: 'production',
      CATALOG_PROVIDER: 'installios',
      DELIVERY_PROVIDER: 'installios',
      INSTALLIOS_API_KEY: 'k'.repeat(32),
      INSTALLIOS_DEFAULT_PRICE_RUB: '790',
      ALLOW_MOCK_PAYMENTS: 'true',
    };

    expect(parseEnv(production)).toMatchObject({ PAYMENT_PROVIDER: 'mock', ALLOW_MOCK_PAYMENTS: true });
    expect(() => parseEnv({ ...production, DEV_USER_ID: '1' })).toThrow(/DEV_USER_ID is allowed only/);
    expect(() => parseEnv({ ...production, ALLOW_MOCK_PAYMENTS: 'false' })).toThrow(/Mock payments are not allowed/);
  });

  it('defaults to production when NODE_ENV is missing', () => {
    const { NODE_ENV: _omit, ...rest } = BASE;
    expect(() => parseEnv(rest)).toThrow(/Mock payments are not allowed/);
  });

  it('requires an explicit payment provider and rejects DEV_USER_ID with real payments', () => {
    const { PAYMENT_PROVIDER: _omit, ...rest } = BASE;
    expect(() => parseEnv(rest)).toThrow(/PAYMENT_PROVIDER/);
    expect(() =>
      parseEnv({
        ...BASE,
        PAYMENT_PROVIDER: 'platega',
        PLATEGA_MERCHANT_ID: '0192a4b8-0000-7000-8000-000000000001',
        PLATEGA_SECRET: 'secret',
        DEV_USER_ID: '1',
      }),
    ).toThrow(/DEV_USER_ID is allowed only/);
  });

  it('needs an explicit channel url for numeric channel ids', () => {
    expect(() => parseEnv({ ...BASE, REQUIRED_CHANNEL: '-1001234567890' })).toThrow(/REQUIRED_CHANNEL_URL/);
  });
});

describe('seller details', () => {
  it('parses the details shown in the legal documents', () => {
    expect(sellerOf(parseEnv({ ...BASE, ...SELLER }))).toEqual({ name: 'iStockApps', email: 'shop@example.com' });
  });

  it('is null in development when nothing is set', () => {
    expect(sellerOf(parseEnv(BASE))).toBeNull();
  });

  it('rejects a malformed email', () => {
    expect(() => parseEnv({ ...BASE, ...SELLER, SELLER_EMAIL: 'not-an-email' })).toThrow(/SELLER_EMAIL/);
  });

  it('refuses partly filled details', () => {
    expect(() => parseEnv({ ...BASE, SELLER_NAME: SELLER.SELLER_NAME })).toThrow(/SELLER_EMAIL/);
  });

  it('requires the details in production', () => {
    expect(() => parseEnv({ ...BASE, NODE_ENV: 'production' })).toThrow(/SELLER_NAME/);
  });
});

describe('links', () => {
  it('builds channel and support links', () => {
    expect(channelUrl({ REQUIRED_CHANNEL: '@my_channel' })).toBe('https://t.me/my_channel');
    expect(channelUrl({ REQUIRED_CHANNEL: '-100123', REQUIRED_CHANNEL_URL: 'https://t.me/+invite' })).toBe(
      'https://t.me/+invite',
    );
    expect(supportUrl({ SUPPORT_USERNAME: 'support_acc' })).toBe('https://t.me/support_acc');
  });
});

describe('Install-IOS settings', () => {
  const INSTALLIOS = {
    ...BASE,
    CATALOG_PROVIDER: 'installios',
    DELIVERY_PROVIDER: 'installios',
    INSTALLIOS_API_KEY: 'iosp_test_key_0123456789',
    INSTALLIOS_DEFAULT_PRICE_RUB: '199',
  };

  it('parses the key, default base url and per-app prices', () => {
    const env = parseEnv({ ...INSTALLIOS, INSTALLIOS_PRICES: '{"app_vk": 299.5}' });

    expect(env.INSTALLIOS_API_BASE).toBe('https://api.installios.ru/v1');
    const priceOf = installiosPriceOf(env);
    expect(priceOf('app_vk')).toBe(29950);
    expect(priceOf('app_other')).toBe(19900);
  });

  it('requires the key and a default price', () => {
    const { INSTALLIOS_API_KEY: _key, ...withoutKey } = INSTALLIOS;
    const { INSTALLIOS_DEFAULT_PRICE_RUB: _price, ...withoutPrice } = INSTALLIOS;

    expect(() => parseEnv(withoutKey)).toThrow(/INSTALLIOS_API_KEY/);
    expect(() => parseEnv(withoutPrice)).toThrow(/INSTALLIOS_DEFAULT_PRICE_RUB/);
  });

  it('rejects broken price JSON and mixed providers', () => {
    expect(() => parseEnv({ ...INSTALLIOS, INSTALLIOS_PRICES: '{oops' })).toThrow(/INSTALLIOS_PRICES/);
    expect(() => parseEnv({ ...INSTALLIOS, INSTALLIOS_PRICES: '{"app_vk": -1}' })).toThrow(/INSTALLIOS_PRICES/);
    expect(() => parseEnv({ ...INSTALLIOS, CATALOG_PROVIDER: 'mock' })).toThrow(/must match/);
  });

  it('lets production run on Install-IOS', () => {
    const env = parseEnv({
      ...INSTALLIOS,
      ...SELLER,
      NODE_ENV: 'production',
      PAYMENT_PROVIDER: 'platega',
      PLATEGA_MERCHANT_ID: '0192a4b8-0000-7000-8000-000000000001',
      PLATEGA_SECRET: 'secret',
    });
    expect(env.DELIVERY_PROVIDER).toBe('installios');
  });
});
