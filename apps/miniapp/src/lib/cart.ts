import { discountTierFor, formatRub, MAX_ORDER_ITEMS, nextDiscountTier } from '@istock/shared';
import { useSyncExternalStore } from 'react';
import { pluralRu } from './format';

/** Only app ids are kept: names and prices are always read fresh from the catalog. */
export const CART_STORAGE_KEY = 'istock.cart.v1';
const APP_ID_MAX = 128;

type CartIds = readonly string[];

function isValidId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= APP_ID_MAX;
}

/** Whatever the storage holds, the cart gets a clean list of distinct ids, or nothing. */
export function readStoredCart(): CartIds {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter(isValidId))].slice(0, MAX_ORDER_ITEMS);
  } catch {
    return [];
  }
}

let ids: CartIds = readStoredCart();
const listeners = new Set<() => void>();

function commit(next: CartIds): void {
  ids = next;
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode or blocked storage: the cart still works until the Mini App is closed.
  }
  listeners.forEach((listener) => listener());
}

export const cartStore = {
  getSnapshot: (): CartIds => ids,

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** False when the app is already there or the cart is full. */
  add(appId: string): boolean {
    if (ids.includes(appId) || ids.length >= MAX_ORDER_ITEMS) return false;
    commit([...ids, appId]);
    return true;
  },

  addMany(appIds: readonly string[]): void {
    const missing = appIds.filter((appId) => !ids.includes(appId));
    commit([...ids, ...missing].slice(0, MAX_ORDER_ITEMS));
  },

  remove(appId: string): void {
    if (ids.includes(appId)) commit(ids.filter((id) => id !== appId));
  },

  clear(): void {
    if (ids.length > 0) commit([]);
  },
};

export function useCartIds(): CartIds {
  return useSyncExternalStore(cartStore.subscribe, cartStore.getSnapshot);
}

/** 1 приложение, 2 приложения, 5 приложений. */
export function formatAppCount(count: number): string {
  return `${count} ${pluralRu(count, ['приложение', 'приложения', 'приложений'])}`;
}

/**
 * "Добавьте ещё 2 приложения для скидки 300 ₽": the whole-order discount at the next tier;
 * null once the best discount is reached.
 */
export function discountHint(itemCount: number): string | null {
  const next = nextDiscountTier(itemCount);
  if (!next) return null;
  const more = itemCount > 0 ? 'ещё ' : '';
  const totalKopecks = next.perItemKopecks * (itemCount + next.itemsNeeded);
  return `Добавьте ${more}${formatAppCount(next.itemsNeeded)} для скидки ${formatRub(totalKopecks)}`;
}

export interface DiscountNotice {
  /** The cart has just reached a tier (or holds the best one). */
  isReached: boolean;
  text: string;
}

/**
 * What to tell the buyer right after the cart grew to `itemCount` apps: always the way to the
 * next discount while there is one (also right when a tier is reached), then the best discount.
 */
export function discountNotice(itemCount: number): DiscountNotice {
  const tier = discountTierFor(itemCount);
  const hint = discountHint(itemCount);
  if (hint) return { isReached: tier?.minItems === itemCount, text: hint };
  return { isReached: true, text: `Скидка ${formatRub(tier?.perItemKopecks ?? 0)} на каждое приложение` };
}
