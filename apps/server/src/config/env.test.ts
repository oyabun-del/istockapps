import { describe, expect, it } from 'vitest';
import { channelUrl, installiosPriceOf, parseEnv, supportUrl } from './env.js';

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

describe('parseEnv', () => {
  it('parses a list of admins, dedupes and applies defaults', () => {
    const env = parseEnv(BASE);

    expect(env.ADMIN_IDS).toEqual([111, 222]);
    expect(env.SUPPORT_USERNAME).toBe('support_acc');
    expect(env.TRUST_PROXY_HOPS).toBe(0);
    expect(env.ALLOW_SANDBOX_PAYMENTS).toBe(false);
    expect(env.PORT).toBe(3000);
    expect(env.SERVE_MINIAPP).toBe(true);
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
          PAYMENT_PROVIDER: 'cispay',
          CISPAY_SHOP_ID: '0192a4b8-0000-7000-8000-000000000001',
          CISPAY_API_KEY: 'cis_sec_x',
        }),
      ).toThrow(/TELEGRAM_OFFLINE/);
    });
  });

  it('accepts an optional https terms of service link', () => {
    expect(parseEnv(BASE).TERMS_URL).toBeUndefined();
    expect(parseEnv({ ...BASE, TERMS_URL: 'https://telegra.ph/terms' }).TERMS_URL).toBe('https://telegra.ph/terms');
    expect(() => parseEnv({ ...BASE, TERMS_URL: 'http://telegra.ph/terms' })).toThrow(/TERMS_URL/);
  });

  it('rejects invalid admin ids with a readable message', () => {
    expect(() => parseEnv({ ...BASE, ADMIN_IDS: '111,abc' })).toThrow(/ADMIN_IDS: Invalid admin ids: abc/);
  });

  it('requires CISPAY credentials when the real provider is selected', () => {
    expect(() => parseEnv({ ...BASE, PAYMENT_PROVIDER: 'cispay' })).toThrow(/CISPAY_SHOP_ID and CISPAY_API_KEY/);
  });

  it('forbids mock payments, mock delivery, dev user and plain http in production', () => {
    const run = () =>
      parseEnv({ ...BASE, NODE_ENV: 'production', DEV_USER_ID: '1', WEBAPP_URL: 'http://shop.example.com' });
    expect(run).toThrow(/Mock payments are not allowed/);
    expect(run).toThrow(/DEV_USER_ID is allowed only/);
    expect(run).toThrow(/WEBAPP_URL must use https/);
    expect(run).toThrow(/fake credentials/);
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
        PAYMENT_PROVIDER: 'cispay',
        CISPAY_SHOP_ID: '0192a4b8-0000-7000-8000-000000000001',
        CISPAY_API_KEY: 'cis_sec_x',
        DEV_USER_ID: '1',
      }),
    ).toThrow(/DEV_USER_ID is allowed only/);
  });

  it('needs an explicit channel url for numeric channel ids', () => {
    expect(() => parseEnv({ ...BASE, REQUIRED_CHANNEL: '-1001234567890' })).toThrow(/REQUIRED_CHANNEL_URL/);
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
      NODE_ENV: 'production',
      PAYMENT_PROVIDER: 'cispay',
      CISPAY_SHOP_ID: '0192a4b8-0000-7000-8000-000000000001',
      CISPAY_API_KEY: 'cis_sec_x',
    });
    expect(env.DELIVERY_PROVIDER).toBe('installios');
  });
});
