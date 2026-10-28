import { describe, expect, it } from 'vitest';
import { calculateCartPricing, MAX_ORDER_ITEMS } from './pricing.js';

const PRICE = 34900;

function pricesOf(count: number, price = PRICE): number[] {
  return Array.from({ length: count }, () => price);
}

describe('calculateCartPricing', () => {
  it('returns zeros for an empty cart and points to the first tier', () => {
    expect(calculateCartPricing([])).toEqual({
      itemCount: 0,
      subtotalKopecks: 0,
      discountPerItemKopecks: 0,
      discountKopecks: 0,
      totalKopecks: 0,
      items: [],
      nextTier: { itemsNeeded: 3, perItemKopecks: 10000 },
    });
  });

  it.each([1, 2])('gives no discount for %i apps', (count) => {
    const pricing = calculateCartPricing(pricesOf(count));

    expect(pricing.discountKopecks).toBe(0);
    expect(pricing.totalKopecks).toBe(PRICE * count);
    expect(pricing.nextTier).toEqual({ itemsNeeded: 3 - count, perItemKopecks: 10000 });
  });

  it.each([3, 4])('takes 100 ₽ off each app for %i apps', (count) => {
    const pricing = calculateCartPricing(pricesOf(count));

    expect(pricing.discountPerItemKopecks).toBe(10000);
    expect(pricing.discountKopecks).toBe(10000 * count);
    expect(pricing.totalKopecks).toBe((PRICE - 10000) * count);
    expect(pricing.nextTier).toEqual({ itemsNeeded: 5 - count, perItemKopecks: 15000 });
  });

  it.each([5, 6, MAX_ORDER_ITEMS])('takes 150 ₽ off each app for %i apps', (count) => {
    const pricing = calculateCartPricing(pricesOf(count));

    expect(pricing.discountPerItemKopecks).toBe(15000);
    expect(pricing.discountKopecks).toBe(15000 * count);
    expect(pricing.totalKopecks).toBe((PRICE - 15000) * count);
    expect(pricing.nextTier).toBeNull();
  });

  it('keeps per-item prices in input order', () => {
    const pricing = calculateCartPricing([19900, 34900, 24900]);

    expect(pricing.subtotalKopecks).toBe(79700);
    expect(pricing.items).toEqual([
      { priceKopecks: 19900, discountKopecks: 10000, totalKopecks: 9900 },
      { priceKopecks: 34900, discountKopecks: 10000, totalKopecks: 24900 },
      { priceKopecks: 24900, discountKopecks: 10000, totalKopecks: 14900 },
    ]);
  });

  it('never discounts a cheap app below 1 ₽', () => {
    const pricing = calculateCartPricing([12000, 9000, 50, PRICE, PRICE]);

    expect(pricing.items.map((item) => item.totalKopecks)).toEqual([100, 100, 50, PRICE - 15000, PRICE - 15000]);
    expect(pricing.discountKopecks).toBe(11900 + 8900 + 0 + 15000 + 15000);
    expect(pricing.totalKopecks).toBe(pricing.subtotalKopecks - pricing.discountKopecks);
  });
});
