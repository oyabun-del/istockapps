import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { cartStore } from '../lib/cart';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete window.Telegram;
  cartStore.clear();
  localStorage.clear();
});
