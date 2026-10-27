import {
  DeliveryAccessRevokedError,
  DeliveryExpiredError,
  DeliveryRateLimitedError,
  type CodeWait,
  type DeliveryProvider,
  type DeliverySnapshot,
  type GroupCredentials,
} from '../delivery/delivery-provider.js';
import { InstalliosApiError, type InstalliosClient } from './installios-client.js';
import type { InstalliosCodeWait, InstalliosOrder } from './installios-schemas.js';

const MS_PER_SECOND = 1000;
const HTTP_CONFLICT = 409;
const HTTP_GONE = 410;
const HTTP_TOO_MANY_REQUESTS = 429;

function fromUnix(seconds: number): Date {
  return new Date(seconds * MS_PER_SECOND);
}

export function toSnapshot(order: InstalliosOrder): DeliverySnapshot {
  const replacing = (order.automatic_replacement?.applications ?? [])
    .filter((item) => item.status === 'pending')
    .map((item) => item.application_id);
  return {
    ref: order.id,
    isExpired: order.status === 'expired',
    isSandbox: order.sandbox,
    expiresAt: fromUnix(order.expires_at),
    groups: order.groups.map((group) => ({
      id: group.id,
      expiresAt: fromUnix(group.expires_at ?? order.expires_at),
      isRevoked: group.access_revoked === true,
      revokedMessage: group.access_message ?? null,
      codesUsed: group.successful_codes,
      codesLimit: group.successful_codes_limit,
      // Copy only what the shop shows; links stay null when the API says so.
      apps: group.applications.map((app) => ({ id: app.id, name: app.name, links: app.links })),
    })),
    replacingAppIds: new Set(replacing),
  };
}

function toCodeWait(wait: InstalliosCodeWait): CodeWait {
  return {
    id: wait.id,
    status: wait.status,
    code: wait.code ?? null,
    validForSeconds: wait.valid_for_seconds ?? null,
    deadlineAt: wait.deadline_at ? fromUnix(wait.deadline_at) : null,
    orderExpiresAt: wait.order_expires_at ? fromUnix(wait.order_expires_at) : null,
    isRevoked: wait.access_revoked === true,
  };
}

/** Turns the API errors the shop reacts to into port errors; everything else passes through. */
function translateError(error: unknown): unknown {
  if (!(error instanceof InstalliosApiError)) return error;
  if (error.status === HTTP_CONFLICT && error.code === 'access_revoked') return new DeliveryAccessRevokedError();
  if (error.status === HTTP_GONE) return new DeliveryExpiredError();
  if (error.status === HTTP_TOO_MANY_REQUESTS) return new DeliveryRateLimitedError(error.retryAfterSeconds);
  return error;
}

async function translated<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error: unknown) {
    throw translateError(error);
  }
}

export class InstalliosDeliveryProvider implements DeliveryProvider {
  constructor(
    private readonly client: Pick<
      InstalliosClient,
      'createOrder' | 'getOrder' | 'getCredentials' | 'startCodeWait' | 'getCodeWait'
    >,
  ) {}

  async createDelivery(externalId: string, appIds: readonly string[]): Promise<DeliverySnapshot> {
    return toSnapshot(await translated(() => this.client.createOrder(externalId, appIds)));
  }

  async getDelivery(ref: string): Promise<DeliverySnapshot> {
    return toSnapshot(await translated(() => this.client.getOrder(ref)));
  }

  async getCredentials(ref: string): Promise<GroupCredentials[]> {
    const credentials = await translated(() => this.client.getCredentials(ref));
    return credentials.groups.map((group) => ({
      groupId: group.id,
      login: group.login,
      password: group.password,
      isRevoked: group.access_revoked === true,
    }));
  }

  async startCodeWait(ref: string, groupId: string, idempotencyKey: string): Promise<CodeWait> {
    return toCodeWait(await translated(() => this.client.startCodeWait(ref, groupId, idempotencyKey)));
  }

  async getCodeWait(waitId: string): Promise<CodeWait> {
    return toCodeWait(await translated(() => this.client.getCodeWait(waitId)));
  }
}
