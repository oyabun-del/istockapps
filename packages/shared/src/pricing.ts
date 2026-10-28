/** Bulk discount: from `minItems` apps in one order, every app gets `perItemKopecks` off. */
export interface DiscountTier {
  minItems: number;
  perItemKopecks: number;
}

/** Sorted from the largest tier down. */
export const BULK_DISCOUNT_TIERS: readonly DiscountTier[] = [
  { minItems: 5, perItemKopecks: 15000 },
  { minItems: 3, perItemKopecks: 10000 },
];

/** Upper bound of apps in one order (and in the cart). */
export const MAX_ORDER_ITEMS = 10;

/** A discount never makes an app cheaper than this. */
const MIN_ITEM_PRICE_KOPECKS = 100;

export interface ItemPricing {
  priceKopecks: number;
  discountKopecks: number;
  totalKopecks: number;
}

export interface CartPricing {
  itemCount: number;
  subtotalKopecks: number;
  /** Discount of the reached tier (an app may get less if it is very cheap). */
  discountPerItemKopecks: number;
  discountKopecks: number;
  totalKopecks: number;
  /** Same order as the input prices. */
  items: ItemPricing[];
  /** The next tier and how many more apps it takes; null once the best tier is reached. */
  nextTier: { itemsNeeded: number; perItemKopecks: number } | null;
}

/** The tier reached by this many apps, or null below the first one. */
export function discountTierFor(itemCount: number): DiscountTier | null {
  return BULK_DISCOUNT_TIERS.find((tier) => itemCount >= tier.minItems) ?? null;
}

/** The closest tier above this many apps, or null once the best tier is reached. */
export function nextDiscountTier(itemCount: number): CartPricing['nextTier'] {
  const next = BULK_DISCOUNT_TIERS.filter((tier) => tier.minItems > itemCount).at(-1);
  return next ? { itemsNeeded: next.minItems - itemCount, perItemKopecks: next.perItemKopecks } : null;
}

/** Price of one app once the tier discount is applied. */
export function priceItem(priceKopecks: number, perItemKopecks: number): ItemPricing {
  const discountKopecks = Math.max(0, Math.min(perItemKopecks, priceKopecks - MIN_ITEM_PRICE_KOPECKS));
  return { priceKopecks, discountKopecks, totalKopecks: priceKopecks - discountKopecks };
}

/** Single source of truth for cart and order prices: the Mini App shows it, the server charges it. */
export function calculateCartPricing(pricesKopecks: readonly number[]): CartPricing {
  const itemCount = pricesKopecks.length;
  const discountPerItemKopecks = discountTierFor(itemCount)?.perItemKopecks ?? 0;
  const items = pricesKopecks.map((price) => priceItem(price, discountPerItemKopecks));
  const sum = (pick: (item: ItemPricing) => number) => items.reduce((total, item) => total + pick(item), 0);

  return {
    itemCount,
    subtotalKopecks: sum((item) => item.priceKopecks),
    discountPerItemKopecks,
    discountKopecks: sum((item) => item.discountKopecks),
    totalKopecks: sum((item) => item.totalKopecks),
    items,
    nextTier: nextDiscountTier(itemCount),
  };
}
