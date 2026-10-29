import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { silentLogger, type Logger } from '../../lib/logger.js';
import {
  applicationsResponseSchema,
  balanceSchema,
  catalogsResponseSchema,
  codeWaitSchema,
  credentialsResponseSchema,
  errorBodySchema,
  healthSchema,
  orderSchema,
  type InstalliosApplication,
  type InstalliosBalance,
  type InstalliosCatalog,
  type InstalliosCodeWait,
  type InstalliosCredentials,
  type InstalliosOrder,
} from './installios-schemas.js';

/** Spec: https://api.installios.ru/docs, contract 1.11.0. */
const REQUEST_TIMEOUT_MS = 15_000;
const REQUEST_ID_PREFIX = 'istock-';
const RETRIABLE_STATUSES = new Set([500, 502, 503, 504]);
const MAX_RETRY_AFTER_SECONDS = 3600;

/** Delays between retries of a network error or HTTP 5xx. The API docs ask for 2, 5, 15 and 30 seconds. */
export const BACKGROUND_RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000, 15_000, 30_000];
/** A buyer is waiting on the other end, so interactive calls retry only once. */
export const INTERACTIVE_RETRY_DELAYS_MS: readonly number[] = [2_000];

export class InstalliosApiError extends Error {
  constructor(
    readonly operation: string,
    /** HTTP status; 0 for network errors and timeouts. */
    readonly status: number,
    /** `error.code` from the API, or a local code such as "network_error". */
    readonly code: string,
    readonly retryAfterSeconds: number | null = null,
  ) {
    // Never include the response body: it may contain credentials or links.
    super(`Install-IOS ${operation} failed: ${status || 'network'} ${code}`);
    this.name = 'InstalliosApiError';
  }
}

export interface InstalliosClientConfig {
  apiBase: string;
  apiKey: string;
  fetchFn?: typeof fetch;
  logger?: Logger;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

interface RequestOptions {
  body?: unknown;
  idempotencyKey?: string;
  retryDelaysMs?: readonly number[];
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(Math.ceil(seconds), MAX_RETRY_AFTER_SECONDS);
}

/** null for a body that is not JSON; a body cut off by the timeout or the network throws. */
async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

/** Successful answers come as `{ ok: true, data, request_id }`; the bare object is accepted too. */
function unwrap(body: unknown): unknown {
  if (body && typeof body === 'object' && 'data' in body) return (body as { data: unknown }).data;
  return body;
}

/**
 * Server-to-server client. The API key never leaves this module, and neither request nor
 * response bodies are logged: only the operation, status, duration and request id.
 */
export class InstalliosClient {
  private readonly fetchFn: typeof fetch;
  private readonly logger: Logger;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly baseUrl: string;

  constructor(private readonly config: InstalliosClientConfig) {
    this.fetchFn = config.fetchFn ?? fetch;
    this.logger = config.logger ?? silentLogger;
    this.sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.baseUrl = config.apiBase.replace(/\/+$/, '');
  }

  async health(): Promise<{ status: string }> {
    return this.request('health', 'GET', '/health', healthSchema);
  }

  async listCatalogs(retryDelaysMs?: readonly number[]): Promise<InstalliosCatalog[]> {
    const data = await this.request('catalogs', 'GET', '/catalogs', catalogsResponseSchema, { retryDelaysMs });
    return data.catalogs;
  }

  async listApplications(catalogId: string, retryDelaysMs?: readonly number[]): Promise<InstalliosApplication[]> {
    const path = `/catalogs/${encodeURIComponent(catalogId)}/applications?include_icons=1`;
    const data = await this.request('applications', 'GET', path, applicationsResponseSchema, { retryDelaysMs });
    return data.applications;
  }

  /** Safe to repeat: the same external_order_id returns the existing order instead of a new one. */
  async createOrder(externalOrderId: string, applicationIds: readonly string[]): Promise<InstalliosOrder> {
    return this.request('create_order', 'POST', '/orders', orderSchema, {
      body: {
        external_order_id: externalOrderId,
        // Auto mode: Install-IOS picks the catalog and account itself, so no catalog_id is sent.
        source_mode: 'auto',
        applications: applicationIds.map((id) => ({ id })),
      },
    });
  }

  async getOrder(orderId: string): Promise<InstalliosOrder> {
    return this.request('get_order', 'GET', `/orders/${encodeURIComponent(orderId)}`, orderSchema);
  }

  /** Never store, cache or log the result. */
  async getCredentials(orderId: string): Promise<InstalliosCredentials> {
    const path = `/orders/${encodeURIComponent(orderId)}/credentials`;
    return this.request('credentials', 'GET', path, credentialsResponseSchema);
  }

  /** Network retries of one attempt must reuse its idempotency key. */
  async startCodeWait(orderId: string, groupId: string, idempotencyKey: string): Promise<InstalliosCodeWait> {
    const path = `/orders/${encodeURIComponent(orderId)}/code-waits`;
    return this.request('start_code_wait', 'POST', path, codeWaitSchema, { body: { group_id: groupId }, idempotencyKey });
  }

  async getCodeWait(waitId: string): Promise<InstalliosCodeWait> {
    return this.request('get_code_wait', 'GET', `/code-waits/${encodeURIComponent(waitId)}`, codeWaitSchema, {
      retryDelaysMs: [],
    });
  }

  async getBalance(): Promise<InstalliosBalance> {
    return this.request('balance', 'GET', '/balance', balanceSchema);
  }

  private async request<S extends z.ZodType>(
    operation: string,
    method: 'GET' | 'POST',
    path: string,
    schema: S,
    options: RequestOptions = {},
  ): Promise<z.infer<S>> {
    const delays = options.retryDelaysMs ?? INTERACTIVE_RETRY_DELAYS_MS;
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.send(operation, method, path, schema, options);
      } catch (error: unknown) {
        const delay = delays[attempt];
        if (delay === undefined || !this.isRetriable(error)) throw error;
        await this.sleep(delay);
      }
    }
  }

  private isRetriable(error: unknown): boolean {
    return error instanceof InstalliosApiError && (error.status === 0 || RETRIABLE_STATUSES.has(error.status));
  }

  private async send<S extends z.ZodType>(
    operation: string,
    method: 'GET' | 'POST',
    path: string,
    schema: S,
    options: RequestOptions,
  ): Promise<z.infer<S>> {
    const requestId = `${REQUEST_ID_PREFIX}${randomUUID()}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiKey}`,
      Accept: 'application/json',
      'X-Request-ID': requestId,
    };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

    const startedAt = Date.now();
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? REQUEST_TIMEOUT_MS),
      });
    } catch {
      this.logger.warn({ operation, requestId, ms: Date.now() - startedAt }, 'Install-IOS request failed');
      throw new InstalliosApiError(operation, 0, 'network_error');
    }

    let body: unknown;
    try {
      body = await readJson(response);
    } catch {
      this.logger.warn({ operation, requestId, ms: Date.now() - startedAt }, 'Install-IOS response was cut off');
      throw new InstalliosApiError(operation, 0, 'network_error');
    }
    const log = { operation, requestId, status: response.status, ms: Date.now() - startedAt };
    if (!response.ok) {
      const parsedError = errorBodySchema.safeParse(body);
      const code = parsedError.success ? parsedError.data.error.code : 'http_error';
      this.logger.warn({ ...log, code }, 'Install-IOS request rejected');
      throw new InstalliosApiError(operation, response.status, code, parseRetryAfter(response.headers.get('retry-after')));
    }

    const parsed = schema.safeParse(unwrap(body));
    if (!parsed.success) {
      // Only the field paths: values may be credentials.
      const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
      this.logger.error({ ...log, fields }, 'Install-IOS response has an unexpected shape');
      throw new InstalliosApiError(operation, response.status, 'invalid_response');
    }
    this.logger.info(log, 'Install-IOS request');
    return parsed.data;
  }
}
