import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../lib/logger.js';
import { InstalliosApiError, InstalliosClient } from './installios-client.js';

const API_KEY = 'iosp_test_key_0123456789abcdef';
const API_BASE = 'https://api.installios.test/v1/';

function envelope(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ ok: status < 400, data, request_id: 'req_1' }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function errorResponse(status: number, code: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ ok: false, error: { code, message: 'x' }, request_id: 'req_1' }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function recordingLogger() {
  const lines: unknown[] = [];
  const logger: Logger = {
    info: (obj) => lines.push(obj),
    warn: (obj) => lines.push(obj),
    error: (obj) => lines.push(obj),
  };
  return { logger, lines };
}

function createClient(fetchFn: typeof fetch, logger?: Logger) {
  const sleep = vi.fn(async (_ms: number) => undefined);
  const client = new InstalliosClient({ apiBase: API_BASE, apiKey: API_KEY, fetchFn, logger, sleep });
  return { client, sleep };
}

const ORDER = {
  id: 'ord_1',
  external_order_id: 'istock-abc',
  status: 'active',
  source_mode: 'auto',
  sandbox: true,
  expires_at: 1_800_000_000,
  fallback_url: 'https://installios.ru/i/xyz',
  qr_url: 'https://installios.ru/qr/xyz',
  billing: { charged: false, amount_kopecks: 0, would_charge_kopecks: 0 },
  groups: [
    {
      id: 'grp_1',
      catalog: 'david',
      status: 'waiting_for_code',
      access_confirmed: false,
      access_inherited: false,
      successful_codes: 0,
      successful_codes_limit: 3,
      applications: [
        {
          id: 'app_1',
          name: 'App',
          billing: {},
          links: { main: 'https://installios.ru/m/1', reserve: 'https://installios.ru/r/1' },
        },
      ],
    },
  ],
};

describe('InstalliosClient', () => {
  it('sends the bearer key, a request id and unwraps the data envelope', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(envelope({ catalogs: [{ id: 'cat_1', name: 'a', applications_count: 2 }] }));
    const { client } = createClient(fetchFn);

    const catalogs = await client.listCatalogs();

    expect(catalogs).toEqual([{ id: 'cat_1', name: 'a', applications_count: 2 }]);
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('https://api.installios.test/v1/catalogs');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(headers['X-Request-ID']).toMatch(/^istock-[0-9a-f-]{36}$/);
    expect(headers['X-Request-ID']?.length).toBeLessThanOrEqual(80);
  });

  it('asks for icons and keeps a null icon', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(envelope({ catalog: { id: 'cat_1' }, applications: [{ id: 'app_1', name: 'A', icon_url: null }] }));
    const { client } = createClient(fetchFn);

    const apps = await client.listApplications('cat_1');

    expect(fetchFn.mock.calls[0]?.[0]).toBe('https://api.installios.test/v1/catalogs/cat_1/applications?include_icons=1');
    expect(apps).toEqual([{ id: 'app_1', name: 'A', icon_url: null }]);
  });

  it('creates orders in auto mode with application ids only', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(envelope(ORDER, 201));
    const { client } = createClient(fetchFn);

    const order = await client.createOrder('istock-abc', ['app_1']);

    expect(order.id).toBe('ord_1');
    const init = fetchFn.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      external_order_id: 'istock-abc',
      source_mode: 'auto',
      applications: [{ id: 'app_1' }],
    });
  });

  it('sends the idempotency key when starting a code wait', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(envelope({ id: 'wait_1', status: 'active', started_at: 1 }, 201));
    const { client } = createClient(fetchFn);

    await client.startCodeWait('ord_1', 'grp_1', 'istock-1-key');

    const init = fetchFn.mock.calls[0]?.[1];
    expect((init?.headers as Record<string, string>)['Idempotency-Key']).toBe('istock-1-key');
    expect(JSON.parse(String(init?.body))).toEqual({ group_id: 'grp_1' });
  });

  it('retries network errors and 503 with the same idempotency key', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(errorResponse(503, 'unavailable'))
      .mockResolvedValue(envelope({ id: 'wait_1', status: 'active', started_at: 1 }));
    const { client, sleep } = createClient(fetchFn);

    // The default interactive policy retries once; the caller passes nothing special here.
    await expect(client.startCodeWait('ord_1', 'grp_1', 'key-1')).rejects.toMatchObject({ status: 503 });
    expect(sleep).toHaveBeenCalledWith(2_000);
    const keys = fetchFn.mock.calls.map(([, init]) => (init?.headers as Record<string, string>)['Idempotency-Key']);
    expect(keys).toEqual(['key-1', 'key-1']);
  });

  it('retries background calls on the 2/5/15/30 s schedule', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(errorResponse(500, 'internal'));
    const { client, sleep } = createClient(fetchFn);

    await expect(client.listCatalogs([2_000, 5_000, 15_000, 30_000])).rejects.toBeInstanceOf(InstalliosApiError);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([2_000, 5_000, 15_000, 30_000]);
    expect(fetchFn).toHaveBeenCalledTimes(5);
  });

  it('does not retry 4xx and reports Retry-After for 429', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(errorResponse(429, 'rate_limited', { 'retry-after': '17' }));
    const { client, sleep } = createClient(fetchFn);

    await expect(client.getCredentials('ord_1')).rejects.toMatchObject({
      status: 429,
      code: 'rate_limited',
      retryAfterSeconds: 17,
    });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('never puts credentials into errors or logs', async () => {
    const { logger, lines } = recordingLogger();
    const leaky = { order_id: 'ord_1', expires_at: 1, storage_policy: 'memory', groups: [{ id: 'grp_1', login: 'secret-login', password: 42 }] };
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(envelope(leaky));
    const { client } = createClient(fetchFn, logger);

    const error = await client.getCredentials('ord_1').catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: 'invalid_response' });
    const dump = JSON.stringify(lines) + String(error);
    expect(dump).not.toContain('secret-login');
    expect(dump).not.toContain(API_KEY);
  });

  it('logs only safe metadata on success', async () => {
    const { logger, lines } = recordingLogger();
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      envelope({ order_id: 'ord_1', expires_at: 1, storage_policy: 'memory', groups: [{ id: 'grp_1', catalog: 'c', login: 'l@x', password: 'p4ss' }] }),
    );
    const { client } = createClient(fetchFn, logger);

    await client.getCredentials('ord_1');

    expect(lines).toHaveLength(1);
    expect(Object.keys(lines[0] as object).sort()).toEqual(['ms', 'operation', 'requestId', 'status']);
    expect(JSON.stringify(lines)).not.toContain('p4ss');
  });

  it('turns a network failure into a typed error', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    const { client } = createClient(fetchFn);

    await expect(client.getCodeWait('wait_1')).rejects.toMatchObject({ status: 0, code: 'network_error' });
    // Status polls are never retried inside a request: the next poll is the retry.
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it('treats a timeout while reading the body as a retriable network error', async () => {
    const stalled = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new DOMException('The operation timed out.', 'TimeoutError'));
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async () => stalled());
    const { client } = createClient(fetchFn);

    await expect(client.getOrder('ord_1')).rejects.toMatchObject({ status: 0, code: 'network_error' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('keeps working when the API adds a status this shop does not know yet', async () => {
    const order = {
      ...ORDER,
      status: 'archived',
      automatic_replacement: { status: 'queued', applications: [{ application_id: 'app_1', status: 'queued' }] },
    };
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(envelope(order))
      .mockResolvedValueOnce(envelope({ id: 'wait_1', status: 'paused' }));
    const { client } = createClient(fetchFn);

    const parsed = await client.getOrder('ord_1');
    expect(parsed.status).toBe('unknown');
    expect(parsed.automatic_replacement).toMatchObject({ status: 'unknown', applications: [{ status: 'unknown' }] });
    // An unknown wait state ends the wait: the buyer can start a new one instead of polling forever.
    expect((await client.getCodeWait('wait_1')).status).toBe('timed_out');
  });
});
