import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '../../lib/logger.js';
import { INTERACTIVE_RETRY_DELAYS_MS } from '../installios/installios-client.js';
import type { InstalliosApplication, InstalliosCatalog } from '../installios/installios-schemas.js';
import { CatalogUnavailableError, InstalliosCatalogProvider } from './installios-catalog-provider.js';

type Pages = Record<string, InstalliosApplication[] | Error>;

function fakeClient(catalogs: InstalliosCatalog[] | Error, pages: Pages) {
  return {
    listCatalogs: vi.fn(async () => {
      if (catalogs instanceof Error) throw catalogs;
      return catalogs;
    }),
    listApplications: vi.fn(async (catalogId: string) => {
      const page = pages[catalogId];
      if (!page || page instanceof Error) throw page ?? new Error('unknown catalog');
      return page;
    }),
  };
}

const CATALOGS: InstalliosCatalog[] = [
  { id: 'cat_a', name: 'a', applications_count: 2 },
  { id: 'cat_b', name: 'b', applications_count: 2 },
];

const PAGES: Pages = {
  cat_a: [
    { id: 'app_tg', name: 'Telegram', icon_url: null },
    { id: 'app_vk', name: 'ВКонтакте', icon_url: 'https://installios.ru/partner-assets/icons/vk.png' },
  ],
  cat_b: [
    { id: 'app_tg', name: 'Telegram', icon_url: 'https://installios.ru/partner-assets/icons/tg.png' },
    { id: 'app_ok', name: 'OK', icon_url: null },
  ],
};

function createProvider(client: ReturnType<typeof fakeClient>, prices: Record<string, number> = {}) {
  return new InstalliosCatalogProvider({
    client,
    priceOf: (appId) => prices[appId] ?? 19900,
    logger: silentLogger,
    retryDelaysMs: [],
  });
}

describe('InstalliosCatalogProvider', () => {
  it('merges every catalog strictly by application id', async () => {
    const client = fakeClient(CATALOGS, PAGES);
    const provider = createProvider(client, { app_vk: 29900 });

    const apps = await provider.listApps({});

    expect(client.listApplications.mock.calls.map(([id]) => id)).toEqual(['cat_a', 'cat_b']);
    expect(apps.map((app) => app.id).sort()).toEqual(['app_ok', 'app_tg', 'app_vk']);
    expect(provider.size).toBe(3);
    const telegram = apps.find((app) => app.id === 'app_tg');
    // The first non-empty icon wins, even if it comes from a later catalog.
    expect(telegram?.iconUrl).toBe('https://installios.ru/partner-assets/icons/tg.png');
    expect(apps.find((app) => app.id === 'app_vk')?.priceKopecks).toBe(29900);
    expect(apps.find((app) => app.id === 'app_ok')?.iconUrl).toMatch(/^data:image\/svg\+xml/);
  });

  it('keeps the last complete snapshot when one catalog fails', async () => {
    const client = fakeClient(CATALOGS, PAGES);
    const provider = createProvider(client);
    expect(await provider.sync()).toBe(true);

    client.listApplications.mockImplementation(async (catalogId: string) => {
      if (catalogId === 'cat_b') throw new Error('boom');
      return [{ id: 'app_tg', name: 'Telegram', icon_url: null }];
    });

    expect(await provider.sync()).toBe(false);
    expect((await provider.listApps({})).map((app) => app.id).sort()).toEqual(['app_ok', 'app_tg', 'app_vk']);
  });

  it('is unavailable before the first complete sync instead of showing a partial list', async () => {
    const client = fakeClient(CATALOGS, { ...PAGES, cat_b: new Error('down') });
    const provider = createProvider(client);

    await expect(provider.listApps({})).rejects.toBeInstanceOf(CatalogUnavailableError);
    await expect(provider.getApp('app_tg')).rejects.toBeInstanceOf(CatalogUnavailableError);
  });

  it('keeps an app while at least one catalog still offers it', async () => {
    const client = fakeClient(CATALOGS, PAGES);
    const provider = createProvider(client);
    await provider.sync();

    client.listCatalogs.mockResolvedValue([CATALOGS[1] as InstalliosCatalog]);
    await provider.sync();

    expect(await provider.getApp('app_tg')).not.toBeNull();
    expect(await provider.getApp('app_vk')).toBeNull();
  });

  it('shares one sync between concurrent callers and filters by name', async () => {
    const client = fakeClient(CATALOGS, PAGES);
    const provider = createProvider(client);

    const [, found] = await Promise.all([provider.listApps({}), provider.listApps({ q: 'вкон' })]);

    expect(client.listCatalogs).toHaveBeenCalledTimes(1);
    expect(found.map((app) => app.id)).toEqual(['app_vk']);
    expect(await provider.listCategories()).toEqual([{ id: 'all', title: 'Все', icon: 'grid_view' }]);
  });

  it('refreshes on a timer that does not keep the process alive', async () => {
    vi.useFakeTimers();
    try {
      const client = fakeClient(CATALOGS, PAGES);
      const provider = createProvider(client);

      provider.start(60_000);
      await vi.advanceTimersByTimeAsync(60_000);
      provider.stop();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(client.listCatalogs).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
  it('keeps the last snapshot when Install-IOS answers with no catalogs', async () => {
    const client = fakeClient(CATALOGS, PAGES);
    const provider = createProvider(client);
    await provider.sync();
    client.listCatalogs.mockResolvedValueOnce([]);

    expect(await provider.sync()).toBe(false);
    expect(provider.size).toBe(3);
  });

  it('keeps the last snapshot when a non-empty catalog comes back empty', async () => {
    const client = fakeClient(CATALOGS, PAGES);
    const provider = createProvider(client);
    await provider.sync();
    client.listApplications.mockResolvedValueOnce([]);

    expect(await provider.sync()).toBe(false);
    expect(provider.size).toBe(3);
  });

  it('loads on demand with the short retries a waiting buyer can afford', async () => {
    const client = fakeClient(CATALOGS, PAGES);
    const provider = new InstalliosCatalogProvider({ client, priceOf: () => 19900, logger: silentLogger });

    await provider.listApps({});

    expect(client.listCatalogs).toHaveBeenCalledWith(INTERACTIVE_RETRY_DELAYS_MS);
  });
});
