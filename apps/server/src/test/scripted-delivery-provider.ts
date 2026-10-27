import type {
  CodeWait,
  DeliveryGroup,
  DeliveryProvider,
  DeliverySnapshot,
  GroupCredentials,
} from '../providers/delivery/delivery-provider.js';

export const HOUR_MS = 60 * 60 * 1000;

export function links(appId: string, version = 1) {
  return { main: `https://install.example/${appId}/v${version}`, reserve: `https://reserve.example/${appId}/v${version}` };
}

export function group(id: string, appIds: readonly string[], overrides: Partial<DeliveryGroup> = {}): DeliveryGroup {
  return {
    id,
    expiresAt: new Date('2026-10-14T18:00:00Z'),
    isRevoked: false,
    revokedMessage: null,
    codesUsed: 0,
    codesLimit: 3,
    apps: appIds.map((appId) => ({ id: appId, name: appId.toUpperCase(), links: links(appId) })),
    ...overrides,
  };
}

/** A revoked group: links are gone, exactly as the API sends it. */
export function revokedGroup(id: string, appIds: readonly string[]): DeliveryGroup {
  return {
    ...group(id, appIds, { isRevoked: true, revokedMessage: 'Учётка заблокирована' }),
    apps: appIds.map((appId) => ({ id: appId, name: appId.toUpperCase(), links: null })),
  };
}

export function snapshot(groups: DeliveryGroup[], overrides: Partial<DeliverySnapshot> = {}): DeliverySnapshot {
  return {
    ref: 'ord_1',
    isExpired: false,
    isSandbox: true,
    expiresAt: new Date('2026-10-14T18:00:00Z'),
    groups,
    replacingAppIds: new Set(),
    ...overrides,
  };
}

export function codeWait(overrides: Partial<CodeWait> = {}): CodeWait {
  return {
    id: 'wait_1',
    status: 'active',
    code: null,
    validForSeconds: null,
    deadlineAt: new Date('2026-10-14T12:05:00Z'),
    orderExpiresAt: null,
    isRevoked: false,
    ...overrides,
  };
}

/** Test double whose answers each test sets explicitly; it records every call. */
export class ScriptedDeliveryProvider implements DeliveryProvider {
  current: DeliverySnapshot = snapshot([group('grp_a', ['app_main'])]);
  credentials: GroupCredentials[] = [{ groupId: 'grp_a', login: 'a@example.com', password: 'pass-a', isRevoked: false }];
  nextWait: CodeWait | Error = codeWait();
  waitStatus: CodeWait | Error = codeWait();
  /** Answers for successive getDelivery calls before falling back to `current`. */
  queuedSnapshots: DeliverySnapshot[] = [];
  readonly calls: Array<{ method: string; args: unknown[] }> = [];

  async createDelivery(externalId: string, appIds: readonly string[]): Promise<DeliverySnapshot> {
    this.calls.push({ method: 'createDelivery', args: [externalId, appIds] });
    return this.current;
  }

  async getDelivery(ref: string): Promise<DeliverySnapshot> {
    this.calls.push({ method: 'getDelivery', args: [ref] });
    return this.queuedSnapshots.shift() ?? this.current;
  }

  async getCredentials(ref: string): Promise<GroupCredentials[]> {
    this.calls.push({ method: 'getCredentials', args: [ref] });
    return this.credentials;
  }

  async startCodeWait(ref: string, groupId: string, idempotencyKey: string): Promise<CodeWait> {
    this.calls.push({ method: 'startCodeWait', args: [ref, groupId, idempotencyKey] });
    if (this.nextWait instanceof Error) throw this.nextWait;
    return this.nextWait;
  }

  async getCodeWait(waitId: string): Promise<CodeWait> {
    this.calls.push({ method: 'getCodeWait', args: [waitId] });
    if (this.waitStatus instanceof Error) throw this.waitStatus;
    return this.waitStatus;
  }

  count(method: string): number {
    return this.calls.filter((call) => call.method === method).length;
  }
}
