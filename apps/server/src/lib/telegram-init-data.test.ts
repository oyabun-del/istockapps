import { describe, expect, it } from 'vitest';
import { BOT_TOKEN } from '../test/fixtures.js';
import { INIT_DATA_MAX_AGE_SECONDS, signInitData, validateInitData } from './telegram-init-data.js';

const NOW = 1_800_000_000;
const USER = JSON.stringify({ id: 42, first_name: 'Иван', username: 'ivan', photo_url: 'https://t.me/i/a.jpg' });

function makeInitData(overrides: Record<string, string> = {}): string {
  return signInitData({ auth_date: String(NOW - 60), query_id: 'AAH', user: USER, ...overrides }, BOT_TOKEN);
}

describe('validateInitData', () => {
  it('accepts correctly signed data and maps the user', () => {
    const result = validateInitData(makeInitData({ start_param: '15' }), BOT_TOKEN, NOW);

    expect(result).toEqual({
      ok: true,
      data: {
        authDate: NOW - 60,
        startParam: '15',
        user: { id: 42, firstName: 'Иван', lastName: null, username: 'ivan', photoUrl: 'https://t.me/i/a.jpg' },
      },
    });
  });

  it('rejects data signed with another bot token', () => {
    const forged = signInitData({ auth_date: String(NOW), user: USER }, '999:another-token-zzzzzzzzzzzzzzzzzzzzzz');
    expect(validateInitData(forged, BOT_TOKEN, NOW)).toEqual({ ok: false, reason: 'bad signature' });
  });

  it('rejects tampered fields', () => {
    const tampered = makeInitData().replace(encodeURIComponent('"id":42'), encodeURIComponent('"id":1'));
    expect(validateInitData(tampered, BOT_TOKEN, NOW).ok).toBe(false);
  });

  it('rejects expired data', () => {
    const old = makeInitData({ auth_date: String(NOW - INIT_DATA_MAX_AGE_SECONDS - 1) });
    expect(validateInitData(old, BOT_TOKEN, NOW)).toEqual({ ok: false, reason: 'expired' });
  });

  it.each([
    ['', 'empty'],
    ['user=1', 'missing hash'],
    ['hash=zz', 'missing hash'],
  ])('rejects malformed input %j', (input, reason) => {
    expect(validateInitData(input, BOT_TOKEN, NOW)).toEqual({ ok: false, reason });
  });

  it('rejects signed data without a valid user', () => {
    expect(validateInitData(signInitData({ auth_date: String(NOW) }, BOT_TOKEN), BOT_TOKEN, NOW)).toEqual({
      ok: false,
      reason: 'missing user',
    });
    expect(validateInitData(signInitData({ auth_date: String(NOW), user: '{oops' }, BOT_TOKEN), BOT_TOKEN, NOW)).toEqual({
      ok: false,
      reason: 'bad user json',
    });
    expect(
      validateInitData(signInitData({ auth_date: String(NOW), user: '{"id":"x"}' }, BOT_TOKEN), BOT_TOKEN, NOW),
    ).toEqual({ ok: false, reason: 'bad user' });
  });

  it('rejects auth_date from the future', () => {
    expect(validateInitData(makeInitData({ auth_date: String(NOW + 3600) }), BOT_TOKEN, NOW)).toEqual({
      ok: false,
      reason: 'auth_date in future',
    });
  });

  it('rejects a missing auth_date', () => {
    expect(validateInitData(signInitData({ user: USER }, BOT_TOKEN), BOT_TOKEN, NOW)).toEqual({
      ok: false,
      reason: 'bad auth_date',
    });
  });
});
