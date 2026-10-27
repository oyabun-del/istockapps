import { randomInt, randomUUID } from 'node:crypto';
import type { CodeWait, DeliveryProvider, DeliverySnapshot, GroupCredentials } from './delivery-provider.js';

const CODE_LENGTH = 6;
export const MOCK_DELIVERY_TTL_MS = 6 * 60 * 60 * 1000;
export const MOCK_CODE_WAIT_MS = 5 * 60 * 1000;
export const MOCK_CODE_VALID_SECONDS = 60;
/** The mock "receives" the code on this poll, as if the buyer requested it on the iPhone. */
export const MOCK_CODE_AFTER_POLLS = 2;
const MOCK_CODES_LIMIT = 3;

interface MockWait {
  id: string;
  polls: number;
  startedAt: Date;
  code: string;
}

/** Development stand-in: keeps fake but well-formed deliveries in memory. Never use in production. */
export class MockDeliveryProvider implements DeliveryProvider {
  private readonly deliveries = new Map<string, DeliverySnapshot>();
  private readonly waits = new Map<string, MockWait>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async createDelivery(externalId: string, appIds: readonly string[]): Promise<DeliverySnapshot> {
    const existing = this.deliveries.get(externalId);
    if (existing) return existing;
    const expiresAt = new Date(this.now().getTime() + MOCK_DELIVERY_TTL_MS);
    const snapshot: DeliverySnapshot = {
      ref: externalId,
      isExpired: false,
      isSandbox: true,
      expiresAt,
      groups: [
        {
          id: `grp_${externalId}`,
          expiresAt,
          isRevoked: false,
          revokedMessage: null,
          codesUsed: 0,
          codesLimit: MOCK_CODES_LIMIT,
          apps: appIds.map((id) => ({
            id,
            name: id,
            links: {
              main: `https://example.com/mock-install/${encodeURIComponent(id)}`,
              reserve: `https://example.com/mock-install/${encodeURIComponent(id)}?reserve=1`,
            },
          })),
        },
      ],
      replacingAppIds: new Set(),
    };
    this.deliveries.set(externalId, snapshot);
    return snapshot;
  }

  async getDelivery(ref: string): Promise<DeliverySnapshot> {
    const snapshot = this.deliveries.get(ref);
    if (!snapshot) throw new Error(`Mock delivery ${ref} not found`);
    return snapshot;
  }

  async getCredentials(ref: string): Promise<GroupCredentials[]> {
    const snapshot = await this.getDelivery(ref);
    return snapshot.groups.map((group) => ({
      groupId: group.id,
      login: `demo.${group.apps[0]?.id ?? 'app'}@example.com`,
      password: 'Mock-Passw0rd!',
      isRevoked: false,
    }));
  }

  async startCodeWait(_ref: string, _groupId: string, idempotencyKey: string): Promise<CodeWait> {
    const existing = this.waits.get(idempotencyKey);
    const wait: MockWait = existing ?? {
      id: `wait_${randomUUID()}`,
      polls: 0,
      startedAt: this.now(),
      code: String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0'),
    };
    this.waits.set(idempotencyKey, wait);
    this.waits.set(wait.id, wait);
    return this.toCodeWait(wait);
  }

  async getCodeWait(waitId: string): Promise<CodeWait> {
    const wait = this.waits.get(waitId);
    if (!wait) throw new Error(`Mock code wait ${waitId} not found`);
    const polled = { ...wait, polls: wait.polls + 1 };
    this.waits.set(waitId, polled);
    return this.toCodeWait(polled);
  }

  private toCodeWait(wait: MockWait): CodeWait {
    const isReady = wait.polls >= MOCK_CODE_AFTER_POLLS;
    return {
      id: wait.id,
      status: isReady ? 'succeeded' : 'active',
      code: isReady ? wait.code : null,
      validForSeconds: isReady ? MOCK_CODE_VALID_SECONDS : null,
      deadlineAt: new Date(wait.startedAt.getTime() + MOCK_CODE_WAIT_MS),
      orderExpiresAt: null,
      isRevoked: false,
    };
  }
}
