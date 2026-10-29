import { calculateCartPricing, discountTierFor, type AppDto, type CartPricing, type ItemPricing } from '@istock/shared';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { cartStore, useCartIds } from '../lib/cart';
import { queryKeys } from '../lib/queries';
import { hapticImpact, hapticNotify } from '../lib/telegram';

/**
 * Apps added from a screen are already in the cache: adding one must not cost a request.
 * The server re-prices the cart at checkout and answers PRICE_CHANGED if it moved.
 */
const CART_PRICE_STALE_MS = 60_000;

export interface CartLine {
  app: AppDto;
  pricing: ItemPricing;
}

export interface CartState {
  ids: readonly string[];
  /** Apps with their discounted prices; empty until every app of the cart is loaded. */
  lines: CartLine[];
  /** Null while some app is still loading or failed to load. */
  pricing: CartPricing | null;
  isLoading: boolean;
  error: unknown;
  /** Some apps left the catalog and were removed from the cart while it was open. */
  hasDroppedApps: boolean;
  refetch: () => void;
}

function isGone(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'NOT_FOUND';
}

/** The cart with live catalog prices. Apps removed from the catalog leave the cart by themselves. */
export function useCart(): CartState {
  const ids = useCartIds();
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: queryKeys.app(id),
      queryFn: () => api.app(id),
      staleTime: CART_PRICE_STALE_MS,
    })),
  });

  const [hasDroppedApps, setHasDroppedApps] = useState(false);
  const goneKey = ids.filter((_, index) => isGone(results[index]?.error)).join(',');
  useEffect(() => {
    if (!goneKey) return;
    goneKey.split(',').forEach((id) => cartStore.remove(id));
    setHasDroppedApps(true);
  }, [goneKey]);

  const apps = results.map((result) => result.data).filter((app): app is AppDto => app !== undefined);
  const isComplete = apps.length === ids.length;
  const pricing = isComplete ? calculateCartPricing(apps.map((app) => app.priceKopecks)) : null;
  const lines = pricing ? apps.map((app, index) => ({ app, pricing: pricing.items[index] as ItemPricing })) : [];

  return {
    ids,
    lines,
    pricing,
    isLoading: results.some((result) => result.isPending),
    error: results.find((result) => result.isError && !isGone(result.error))?.error ?? null,
    hasDroppedApps,
    refetch: () => results.forEach((result) => void result.refetch()),
  };
}

/** Adds an app the screen already has, so the cart shows its price at once. */
export function useAddToCart(): (app: AppDto) => boolean {
  const queryClient = useQueryClient();
  return (app) => {
    queryClient.setQueryData(queryKeys.app(app.id), app);
    const isAdded = cartStore.add(app.id);
    if (!isAdded) {
      hapticNotify('warning');
      return false;
    }
    const count = cartStore.getSnapshot().length;
    if (discountTierFor(count)?.minItems === count) hapticNotify('success');
    else hapticImpact('light');
    return true;
  };
}
