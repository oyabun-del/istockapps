import { describe, expect, it, vi } from 'vitest';
import { PartnerAdminService } from './partner-admin-service.js';

function createService(isSynced = true) {
  const client = {
    getBalance: vi.fn(async () => ({ net_rubles: -150.5, debt_rubles: 0, advance_rubles: 150.5, currency: 'RUB' })),
  };
  const catalog = { sync: vi.fn(async () => isSynced), size: 108 };
  return { service: new PartnerAdminService({ client, catalog }), catalog };
}

describe('PartnerAdminService', () => {
  it('formats the balance in rubles', async () => {
    const text = await createService().service.balanceText();
    expect(text).toContain('Аванс: 150,50');
    expect(text).toContain('Задолженность: 0,00');
  });

  it('reports the catalog sync result', async () => {
    expect(await createService(true).service.syncText()).toContain('обновлён: 108');
    expect(await createService(false).service.syncText()).toContain('прежний список (108');
  });
});
