import { describe, expect, it } from 'vitest';
import { channelUrl, parseEnv, supportUrl } from './env.js';

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
