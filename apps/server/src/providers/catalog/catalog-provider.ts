import type { AppDto, CatalogQuery, CategoryDto } from '@istock/shared';

/** Category id that means "no filter". */
export const ALL_CATEGORY = 'all';

/** Port for the external catalog API (apps list, icons, prices). */
export interface CatalogProvider {
  listCategories(): Promise<CategoryDto[]>;
  listApps(query: CatalogQuery): Promise<AppDto[]>;
  /** Returns null when the app does not exist or is not for sale. */
  getApp(id: string): Promise<AppDto | null>;
}
