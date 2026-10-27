import type { AppDto, CatalogQuery, CategoryDto } from '@istock/shared';
import { getErrorMessage } from '../../lib/app-error.js';
import type { Logger } from '../../lib/logger.js';
import { BACKGROUND_RETRY_DELAYS_MS, type InstalliosClient } from '../installios/installios-client.js';
import { ALL_CATEGORY, type CatalogProvider } from './catalog-provider.js';
import { initialOf, placeholderIcon } from './placeholder-icon.js';

/** The API docs ask for a background refresh every 5–10 minutes. */
export const CATALOG_SYNC_INTERVAL_MS = 5 * 60 * 1000;

/** Install-IOS has no categories, so the shop shows a single "all" tab. */
const CATEGORIES: readonly CategoryDto[] = [{ id: ALL_CATEGORY, title: 'Все', icon: 'grid_view' }];

export type PriceResolver = (appId: string) => number;

export interface InstalliosCatalogDeps {
  client: Pick<InstalliosClient, 'listCatalogs' | 'listApplications'>;
  /** Price in kopecks for an Install-IOS application id. */
  priceOf: PriceResolver;
  logger: Logger;
  retryDelaysMs?: readonly number[];
}

interface CatalogItem {
  id: string;
  name: string;
  iconUrl: string | null;
  /** Diagnostics only: which sources offer the app. Never shown to buyers. */
  catalogIds: readonly string[];
}

export class CatalogUnavailableError extends Error {
  constructor() {
    super('Install-IOS catalog has not been loaded yet');
    this.name = 'CatalogUnavailableError';
  }
}

function matchesQuery(app: AppDto, query: CatalogQuery): boolean {
  const q = query.q?.toLocaleLowerCase('ru-RU');
  return !q || app.name.toLocaleLowerCase('ru-RU').includes(q);
}

/**
 * One storefront merged from every Install-IOS catalog, keyed strictly by application id.
 * The visible snapshot is replaced only after all catalogs loaded; any failure keeps the last good one.
 */
export class InstalliosCatalogProvider implements CatalogProvider {
  private apps: readonly AppDto[] | null = null;
  private byId: ReadonlyMap<string, AppDto> = new Map();
  private inflight: Promise<boolean> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: InstalliosCatalogDeps) {}

  /** Initial sync plus a periodic refresh; the timer does not keep the process alive. */
  start(intervalMs = CATALOG_SYNC_INTERVAL_MS): void {
    void this.sync();
    this.timer = setInterval(() => void this.sync(), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Concurrent calls share one run. Resolves true when a fresh snapshot was installed. */
  sync(): Promise<boolean> {
    this.inflight ??= this.load().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  get size(): number {
    return this.apps?.length ?? 0;
  }

  async listCategories(): Promise<CategoryDto[]> {
    return [...CATEGORIES];
  }

  async listApps(query: CatalogQuery): Promise<AppDto[]> {
    const apps = await this.snapshot();
    return apps.filter((app) => matchesQuery(app, query));
  }

  async getApp(id: string): Promise<AppDto | null> {
    await this.snapshot();
    return this.byId.get(id) ?? null;
  }

  /** Before the first good sync, try once more instead of showing an incomplete list. */
  private async snapshot(): Promise<readonly AppDto[]> {
    if (!this.apps) await this.sync();
    if (!this.apps) throw new CatalogUnavailableError();
    return this.apps;
  }

  private async load(): Promise<boolean> {
    try {
      const items = await this.fetchAll();
      const apps = items
        .map((item) => this.toAppDto(item))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru-RU'));
      this.apps = apps;
      this.byId = new Map(apps.map((app) => [app.id, app]));
      this.deps.logger.info({ apps: apps.length }, 'Install-IOS catalog synced');
      return true;
    } catch (error: unknown) {
      this.deps.logger.warn(
        { err: getErrorMessage(error), keptApps: this.apps?.length ?? 0 },
        'Install-IOS catalog sync failed; keeping the last complete snapshot',
      );
      return false;
    }
  }

  private async fetchAll(): Promise<CatalogItem[]> {
    const retry = this.deps.retryDelaysMs ?? BACKGROUND_RETRY_DELAYS_MS;
    const catalogs = await this.deps.client.listCatalogs(retry);
    const pages = await Promise.all(
      catalogs.map(async (catalog) => ({
        catalogId: catalog.id,
        applications: await this.deps.client.listApplications(catalog.id, retry),
      })),
    );

    const merged = new Map<string, CatalogItem>();
    for (const { catalogId, applications } of pages) {
      for (const application of applications) {
        const existing = merged.get(application.id);
        merged.set(application.id, {
          id: application.id,
          name: existing?.name ?? application.name,
          iconUrl: existing?.iconUrl || application.icon_url || null,
          catalogIds: [...(existing?.catalogIds ?? []), catalogId],
        });
      }
    }
    return [...merged.values()];
  }

  private toAppDto(item: CatalogItem): AppDto {
    return {
      id: item.id,
      name: item.name,
      subtitle: '',
      iconUrl: item.iconUrl ?? placeholderIcon(initialOf(item.name)),
      categoryId: ALL_CATEGORY,
      priceKopecks: this.deps.priceOf(item.id),
      version: null,
      minIos: null,
    };
  }
}
