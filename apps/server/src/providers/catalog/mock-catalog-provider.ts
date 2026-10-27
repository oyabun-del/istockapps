import type { AppDto, CatalogQuery, CategoryDto } from '@istock/shared';
import { ALL_CATEGORY, type CatalogProvider } from './catalog-provider.js';
import { placeholderIcon } from './placeholder-icon.js';

const CATEGORIES: readonly CategoryDto[] = [
  { id: ALL_CATEGORY, title: 'Все', icon: 'grid_view' },
  { id: 'finance', title: 'Банки и финансы', icon: 'account_balance' },
  { id: 'games', title: 'Игры', icon: 'sports_esports' },
  { id: 'services', title: 'Сервисы и фото', icon: 'auto_fix_high' },
];

const APPS: readonly AppDto[] = [
  {
    id: 'sberbank',
    name: 'СберБанк Онлайн',
    subtitle: 'Официальный клиент',
    iconUrl: placeholderIcon('С', '#107c41', '#1db954'),
    categoryId: 'finance',
    priceKopecks: 34900,
    version: '15.8.0',
    minIos: '14.0',
  },
  {
    id: 'tbank',
    name: 'Т-Банк',
    subtitle: 'Банк и инвестиции',
    iconUrl: placeholderIcon('Т', '#2b2b2b', '#4a4a4a'),
    categoryId: 'finance',
    priceKopecks: 19900,
    version: '7.12.1',
    minIos: '15.0',
  },
  {
    id: 'alfabank',
    name: 'Альфа-Банк',
    subtitle: 'Мобильный банк',
    iconUrl: placeholderIcon('А', '#ef3124', '#b3150b'),
    categoryId: 'finance',
    priceKopecks: 19900,
    version: '12.4.0',
    minIos: '14.0',
  },
  {
    id: 'vtb-invest',
    name: 'ВТБ Мои Инвестиции',
    subtitle: 'Брокерское приложение',
    iconUrl: placeholderIcon('В', '#0a2896', '#2f5bea'),
    categoryId: 'finance',
    priceKopecks: 19900,
    version: '3.30.0',
    minIos: '15.0',
  },
  {
    id: 'brawl-stars',
    name: 'Brawl Stars',
    subtitle: 'Supercell',
    iconUrl: placeholderIcon('B', '#f7b500', '#e05a00'),
    categoryId: 'games',
    priceKopecks: 24900,
    version: '59.0',
    minIos: '13.0',
  },
  {
    id: 'minecraft',
    name: 'Minecraft',
    subtitle: 'Mojang',
    iconUrl: placeholderIcon('M', '#5b8c32', '#3b5e1f'),
    categoryId: 'games',
    priceKopecks: 29900,
    version: '1.21.40',
    minIos: '14.0',
  },
  {
    id: 'canva',
    name: 'Canva',
    subtitle: 'Дизайн и фото',
    iconUrl: placeholderIcon('C', '#00c4cc', '#7d2ae8'),
    categoryId: 'services',
    priceKopecks: 19900,
    version: '2.280.0',
    minIos: '15.0',
  },
];

function matchesQuery(app: AppDto, query: CatalogQuery): boolean {
  const category = query.category && query.category !== ALL_CATEGORY ? query.category : null;
  if (category && app.categoryId !== category) return false;
  const q = query.q?.toLocaleLowerCase('ru-RU');
  if (!q) return true;
  return app.name.toLocaleLowerCase('ru-RU').includes(q) || app.subtitle.toLocaleLowerCase('ru-RU').includes(q);
}

export class MockCatalogProvider implements CatalogProvider {
  async listCategories(): Promise<CategoryDto[]> {
    return [...CATEGORIES];
  }

  async listApps(query: CatalogQuery): Promise<AppDto[]> {
    return APPS.filter((app) => matchesQuery(app, query));
  }

  async getApp(id: string): Promise<AppDto | null> {
    return APPS.find((app) => app.id === id) ?? null;
  }
}
