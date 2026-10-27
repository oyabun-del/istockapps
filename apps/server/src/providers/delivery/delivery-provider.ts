import type { CodeWaitStatus } from '@istock/shared';

export interface DeliveryLinks {
  main: string;
  reserve: string;
}

export interface DeliveryApp {
  id: string;
  name: string;
  /** null when access was revoked or the app is temporarily unavailable. */
  links: DeliveryLinks | null;
}

/** One Apple account with its apps. Ids can change after a replacement: never cache them. */
export interface DeliveryGroup {
  id: string;
  expiresAt: Date;
  isRevoked: boolean;
  revokedMessage: string | null;
  codesUsed: number;
  codesLimit: number;
  apps: DeliveryApp[];
}

/** Full state of a delivery at one moment; each fetch replaces the previous snapshot entirely. */
export interface DeliverySnapshot {
  ref: string;
  isExpired: boolean;
  isSandbox: boolean;
  expiresAt: Date;
  groups: DeliveryGroup[];
  /** App ids still waiting for a free replacement account. */
  replacingAppIds: ReadonlySet<string>;
}

/** Live values: keep in memory only, never persist or log. */
export interface GroupCredentials {
  groupId: string;
  login: string;
  password: string;
  isRevoked: boolean;
}

export interface CodeWait {
  id: string;
  status: CodeWaitStatus;
  code: string | null;
  validForSeconds: number | null;
  deadlineAt: Date | null;
  /** New order deadline: starting a wait may shorten it. */
  orderExpiresAt: Date | null;
  isRevoked: boolean;
}

/** Access to the group is withdrawn for good: stop the attempt and refresh the delivery. */
export class DeliveryAccessRevokedError extends Error {
  constructor() {
    super('Access to the delivery group was revoked');
    this.name = 'DeliveryAccessRevokedError';
  }
}

export class DeliveryRateLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number | null) {
    super('Delivery API rate limit reached');
    this.name = 'DeliveryRateLimitedError';
  }
}

export class DeliveryExpiredError extends Error {
  constructor() {
    super('Delivery has expired');
    this.name = 'DeliveryExpiredError';
  }
}

/** Port for the external delivery API (Install-IOS in production, a mock in development). */
export interface DeliveryProvider {
  /** Idempotent: repeating it with the same external id returns the existing delivery. */
  createDelivery(externalId: string, appIds: readonly string[]): Promise<DeliverySnapshot>;
  getDelivery(ref: string): Promise<DeliverySnapshot>;
  getCredentials(ref: string): Promise<GroupCredentials[]>;
  /** Throws DeliveryAccessRevokedError when the group was blocked. */
  startCodeWait(ref: string, groupId: string, idempotencyKey: string): Promise<CodeWait>;
  getCodeWait(waitId: string): Promise<CodeWait>;
}
