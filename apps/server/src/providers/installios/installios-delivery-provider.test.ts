import { describe, expect, it, vi } from 'vitest';
import {
  DeliveryAccessRevokedError,
  DeliveryExpiredError,
  DeliveryRateLimitedError,
} from '../delivery/delivery-provider.js';
import { InstalliosApiError } from './installios-client.js';
import { InstalliosDeliveryProvider, toSnapshot } from './installios-delivery-provider.js';
import type { InstalliosOrder } from './installios-schemas.js';

const BASE_ORDER: InstalliosOrder = {
  id: 'ord_1',
  external_order_id: 'istock-1',
  status: 'active',
  sandbox: false,
  expires_at: 1_800_000_000,
  fallback_url: 'https://installios.ru/i/x',
  qr_url: 'https://installios.ru/qr/x',
  groups: [
    {
      id: 'grp_blocked',
      status: 'waiting_for_code',
      access_revoked: true,
      access_revocation_reason: 'account_blocked',
      access_message: 'Учётка заблокирована',
      successful_codes: 1,
      successful_codes_limit: 3,
      applications: [{ id: 'app_a', name: 'A', links: null }],
    },
    {
      id: 'grp_ok',
      status: 'code_received',
      expires_at: 1_800_003_600,
      successful_codes: 0,
      successful_codes_limit: 3,
      applications: [{ id: 'app_b', name: 'B', links: { main: 'https://m', reserve: 'https://r' } }],
    },
  ],
  automatic_replacement: {
    status: 'partial',
    applications: [
      { application_id: 'app_a', status: 'pending', expires_at: 1_800_000_000 },
      { application_id: 'app_c', status: 'replaced', expires_at: 1_800_000_000 },
    ],
  },
};

function fakeClient() {
  return {
    createOrder: vi.fn(async () => BASE_ORDER),
    getOrder: vi.fn(async () => BASE_ORDER),
    getCredentials: vi.fn(async () => ({
      order_id: 'ord_1',
      groups: [
        { id: 'grp_blocked', login: '', password: '', access_revoked: true },
        { id: 'grp_ok', login: 'b@example.com', password: 'pass' },
      ],
    })),
    startCodeWait: vi.fn(),
    getCodeWait: vi.fn(),
  };
}

describe('toSnapshot', () => {
  it('maps revocation, per-group deadlines and pending replacements', () => {
    const snapshot = toSnapshot(BASE_ORDER);

    expect(snapshot.ref).toBe('ord_1');
    expect(snapshot.groups[0]).toMatchObject({
      id: 'grp_blocked',
      isRevoked: true,
      revokedMessage: 'Учётка заблокирована',
      expiresAt: new Date(1_800_000_000_000),
      codesUsed: 1,
    });
    expect(snapshot.groups[0]?.apps[0]?.links).toBeNull();
    expect(snapshot.groups[1]?.expiresAt).toEqual(new Date(1_800_003_600_000));
    expect([...snapshot.replacingAppIds]).toEqual(['app_a']);
  });

  it('treats a missing automatic_replacement as no replacement at all', () => {
    const { automatic_replacement: _ignored, ...withoutReplacement } = BASE_ORDER;
    expect(toSnapshot(withoutReplacement).replacingAppIds.size).toBe(0);
    expect(toSnapshot({ ...BASE_ORDER, status: 'expired' }).isExpired).toBe(true);
  });
});

describe('InstalliosDeliveryProvider', () => {
  it('passes revocation flags of credentials through', async () => {
    const provider = new InstalliosDeliveryProvider(fakeClient());

    expect(await provider.getCredentials('ord_1')).toEqual([
      { groupId: 'grp_blocked', login: '', password: '', isRevoked: true },
      { groupId: 'grp_ok', login: 'b@example.com', password: 'pass', isRevoked: false },
    ]);
  });

  it('maps code wait fields and unix times', async () => {
    const client = fakeClient();
    client.startCodeWait.mockResolvedValue({
      id: 'wait_1',
      status: 'active',
      deadline_at: 1_800_000_300,
      order_expires_at: 1_800_000_900,
    });
    const provider = new InstalliosDeliveryProvider(client);

    expect(await provider.startCodeWait('ord_1', 'grp_ok', 'key')).toEqual({
      id: 'wait_1',
      status: 'active',
      code: null,
      validForSeconds: null,
      deadlineAt: new Date(1_800_000_300_000),
      orderExpiresAt: new Date(1_800_000_900_000),
      isRevoked: false,
    });
  });

  it('translates the API errors the shop reacts to', async () => {
    const client = fakeClient();
    const provider = new InstalliosDeliveryProvider(client);

    client.startCodeWait.mockRejectedValueOnce(new InstalliosApiError('start_code_wait', 409, 'access_revoked'));
    await expect(provider.startCodeWait('ord_1', 'grp', 'k')).rejects.toBeInstanceOf(DeliveryAccessRevokedError);

    client.getCodeWait.mockRejectedValueOnce(new InstalliosApiError('get_code_wait', 410, 'order_expired'));
    await expect(provider.getCodeWait('wait_1')).rejects.toBeInstanceOf(DeliveryExpiredError);

    client.getOrder.mockRejectedValueOnce(new InstalliosApiError('get_order', 429, 'rate_limited', 9));
    await expect(provider.getDelivery('ord_1')).rejects.toMatchObject(new DeliveryRateLimitedError(9));

    const other = new InstalliosApiError('get_order', 409, 'something_else');
    client.getOrder.mockRejectedValueOnce(other);
    await expect(provider.getDelivery('ord_1')).rejects.toBe(other);
  });
});
