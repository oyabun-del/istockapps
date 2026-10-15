import type { AppDto, CatalogQuery, CategoryDto } from '@istock/shared';

/**
 * Port for the external catalog API (apps list, icons, prices).
 * Replace MockCatalogProvider with an HTTP implementation once the API is available.
 */
export interface CatalogProvider {
  listCategories(): Promise<CategoryDto[]>;
  listApps(query: CatalogQuery): Promise<AppDto[]>;
  /** Returns null when the app does not exist or is not for sale. */
  getApp(id: string): Promise<AppDto | null>;
}
