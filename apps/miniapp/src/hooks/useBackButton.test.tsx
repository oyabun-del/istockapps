import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ROUTER_FUTURE } from '../lib/router';
import { useBackButton } from './useBackButton';

function installBackButton() {
  const handlers: Array<() => void> = [];
  const button = { show: vi.fn(), hide: vi.fn(), onClick: vi.fn((cb: () => void) => handlers.push(cb)), offClick: vi.fn() };
  window.Telegram = { WebApp: { initData: 'hash=abc', BackButton: button } as never };
  return () => act(() => handlers.at(-1)?.());
}

function Screen() {
  useBackButton('/');
  return <span data-testid="path">{useLocation().pathname}</span>;
}

function renderAt(entries: string[]) {
  render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1} future={ROUTER_FUTURE}>
      <Routes>
        <Route path="*" element={<Screen />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('useBackButton', () => {
  it('goes back through the history the Mini App made', () => {
    const pressBack = installBackButton();
    renderAt(['/orders', '/orders/7']);

    pressBack();

    expect(screen.getByTestId('path')).toHaveTextContent(/^\/orders$/);
  });

  it('opens the fallback when the Mini App started on this screen', () => {
    const pressBack = installBackButton();
    renderAt(['/orders/7']);

    pressBack();

    expect(screen.getByTestId('path')).toHaveTextContent(/^\/$/);
  });
});
