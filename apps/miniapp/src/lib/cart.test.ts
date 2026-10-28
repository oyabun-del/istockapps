import { MAX_ORDER_ITEMS } from '@istock/shared';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CART_STORAGE_KEY, cartStore, discountHint, discountNotice, readStoredCart, useCartIds } from './cart';

describe('cartStore', () => {
  it('adds each app once, removes and clears', () => {
    expect(cartStore.add('sberbank')).toBe(true);
    expect(cartStore.add('sberbank')).toBe(false);
    cartStore.add('tbank');
    expect(cartStore.getSnapshot()).toEqual(['sberbank', 'tbank']);

    cartStore.remove('sberbank');
    expect(cartStore.getSnapshot()).toEqual(['tbank']);

    cartStore.clear();
    expect(cartStore.getSnapshot()).toEqual([]);
  });

  it('refuses to grow past the order limit', () => {
    for (let index = 0; index < MAX_ORDER_ITEMS; index += 1) cartStore.add(`app-${index}`);

    expect(cartStore.add('one-more')).toBe(false);
    expect(cartStore.getSnapshot()).toHaveLength(MAX_ORDER_ITEMS);
  });

  it('adds several apps at once, skipping the ones already there', () => {
    cartStore.add('sberbank');

    cartStore.addMany(['tbank', 'sberbank', 'canva']);

    expect(cartStore.getSnapshot()).toEqual(['sberbank', 'tbank', 'canva']);
  });

  it('persists the cart between launches', () => {
    cartStore.add('sberbank');

    expect(JSON.parse(localStorage.getItem(CART_STORAGE_KEY) ?? '[]')).toEqual(['sberbank']);
    expect(readStoredCart()).toEqual(['sberbank']);
  });

  it('ignores a damaged or foreign stored value', () => {
    for (const raw of ['{', '"x"', '{"a":1}', '[1,2]', JSON.stringify(['ok', 'x'.repeat(200)])]) {
      localStorage.setItem(CART_STORAGE_KEY, raw);
      expect(readStoredCart()).toEqual(raw.startsWith('["ok"') ? ['ok'] : []);
    }
  });

  it('keeps working in memory when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(cartStore.add('sberbank')).toBe(true);
    expect(cartStore.getSnapshot()).toEqual(['sberbank']);
  });

  it('re-renders subscribers on change', () => {
    const { result } = renderHook(() => useCartIds());

    act(() => {
      cartStore.add('sberbank');
    });

    expect(result.current).toEqual(['sberbank']);
  });
});

describe('discount copy', () => {
  it('tells how many apps are left to the next discount', () => {
    expect(discountHint(0)).toBe('Добавьте 3 приложения для скидки 300 ₽');
    expect(discountHint(1)).toBe('Добавьте ещё 2 приложения для скидки 300 ₽');
    expect(discountHint(2)).toBe('Добавьте ещё 1 приложение для скидки 300 ₽');
    expect(discountHint(3)).toBe('Добавьте ещё 2 приложения для скидки 750 ₽');
    expect(discountHint(4)).toBe('Добавьте ещё 1 приложение для скидки 750 ₽');
    expect(discountHint(5)).toBeNull();
  });

  it('keeps pointing to the next discount, marking a just reached tier', () => {
    expect(discountNotice(1)).toEqual({ isReached: false, text: 'Добавьте ещё 2 приложения для скидки 300 ₽' });
    expect(discountNotice(3)).toEqual({ isReached: true, text: 'Добавьте ещё 2 приложения для скидки 750 ₽' });
    expect(discountNotice(4)).toEqual({ isReached: false, text: 'Добавьте ещё 1 приложение для скидки 750 ₽' });
    expect(discountNotice(5)).toEqual({ isReached: true, text: 'Скидка 150 ₽ на каждое приложение' });
    expect(discountNotice(7)).toEqual({ isReached: true, text: 'Скидка 150 ₽ на каждое приложение' });
  });
});
