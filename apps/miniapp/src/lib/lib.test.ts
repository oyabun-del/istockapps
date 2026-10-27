import { describe, expect, it, vi } from 'vitest';
import { ApiError, api, errorMessage } from './api';
import { copyText } from './clipboard';
import { FALLBACK_ICON, iconFontNames, injectIconNames, toIconName } from './icons';
import { createQueryClient, queryKeys } from './queries';
import {
  getStartParam,
  getTelegramProfile,
  hapticImpact,
  initTelegram,
  openExternalLink,
  openTelegramLink,
  showBackButton,
} from './telegram';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function installWebApp(overrides: Record<string, unknown> = {}) {
  const webApp = {
    initData: 'query_id=1&hash=abc',
    initDataUnsafe: { user: { id: 1, first_name: 'Иван', username: 'ivan' }, start_param: '15' },
    version: '8.0',
    ready: vi.fn(),
    expand: vi.fn(),
    isVersionAtLeast: vi.fn(() => true),
    setHeaderColor: vi.fn(),
    setBackgroundColor: vi.fn(),
    setBottomBarColor: vi.fn(),
    disableVerticalSwipes: vi.fn(),
    openLink: vi.fn(),
    openTelegramLink: vi.fn(),
    BackButton: { show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() },
    HapticFeedback: { impactOccurred: vi.fn(), notificationOccurred: vi.fn(), selectionChanged: vi.fn() },
    ...overrides,
  };
  window.Telegram = { WebApp: webApp as never };
  return webApp;
}

describe('api client', () => {
  it('sends initData and unwraps the envelope', async () => {
    installWebApp();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ success: true, data: [{ id: 'all' }], error: null }));

    const result = await api.categories();

    expect(result).toEqual([{ id: 'all' }]);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/catalog/categories');
    expect((init?.headers as Record<string, string>).Authorization).toBe('tma query_id=1&hash=abc');
  });

  it('builds catalog query strings without empty params', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => jsonResponse({ success: true, data: [], error: null }));
    await api.apps({ q: 'сбер', category: undefined });
    await api.apps({});
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/catalog/apps?q=%D1%81%D0%B1%D0%B5%D1%80');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/catalog/apps');
  });

  it('posts JSON bodies', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ success: true, data: { id: 1 }, error: null }));
    await api.createOrder({ appId: 'sberbank', paymentMethod: 'SBP' });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ appId: 'sberbank', paymentMethod: 'SBP' });
  });

  it('throws ApiError with the server code', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ success: false, data: null, error: { code: 'NOT_SUBSCRIBED', message: 'Подпишитесь' } }, 403),
    );
    await expect(api.orders()).rejects.toMatchObject({ code: 'NOT_SUBSCRIBED', status: 403, message: 'Подпишитесь' });
  });

  it('maps network and parsing failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(api.me()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('<html>', { status: 502 }));
    await expect(api.me()).rejects.toMatchObject({ code: 'BAD_RESPONSE', status: 502 });
  });

  it('produces user-facing messages', () => {
    expect(errorMessage(new ApiError('NOT_FOUND', 'Заказ не найден', 404))).toBe('Заказ не найден');
    expect(errorMessage(new Error('boom'))).toMatch(/Что-то пошло не так/);
  });
});

describe('telegram wrapper', () => {
  it('falls back to window.open outside Telegram', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openExternalLink('https://pay.example.com');
    openTelegramLink('https://t.me/support');
    expect(open).toHaveBeenCalledTimes(2);
    expect(getTelegramProfile()).toBeNull();
    expect(getStartParam()).toBeNull();
    expect(showBackButton(() => undefined)).toBeTypeOf('function');
  });

  it('uses the WebApp API inside Telegram', () => {
    const webApp = installWebApp();
    initTelegram();
    openExternalLink('https://pay.example.com');
    openTelegramLink('https://t.me/support');
    hapticImpact();
    const cleanup = showBackButton(() => undefined);
    cleanup();

    expect(webApp.ready).toHaveBeenCalled();
    expect(webApp.setHeaderColor).toHaveBeenCalledWith('#10131a');
    expect(webApp.openLink).toHaveBeenCalledWith('https://pay.example.com');
    expect(webApp.openTelegramLink).toHaveBeenCalledWith('https://t.me/support');
    expect(webApp.BackButton.hide).toHaveBeenCalled();
    expect(getTelegramProfile()).toEqual({ firstName: 'Иван', username: 'ivan', photoUrl: null });
    expect(getStartParam()).toBe('15');
  });

  it('skips unsupported features on old clients', () => {
    const webApp = installWebApp({ isVersionAtLeast: vi.fn(() => false) });
    initTelegram();
    expect(webApp.setHeaderColor).not.toHaveBeenCalled();
  });
});

describe('query client', () => {
  it('refetches the profile when the API reports NOT_SUBSCRIBED', async () => {
    const client = createQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    await client
      .fetchQuery({
        queryKey: queryKeys.orders,
        queryFn: () => Promise.reject(new ApiError('NOT_SUBSCRIBED', 'x', 403)),
        retry: false,
      })
      .catch(() => undefined);

    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.me });
  });

  it('refetches the profile when an action reports NOT_SUBSCRIBED', async () => {
    const client = createQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    await client
      .getMutationCache()
      .build(client, { mutationFn: () => Promise.reject(new ApiError('NOT_SUBSCRIBED', 'x', 403)) })
      .execute(undefined)
      .catch(() => undefined);

    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.me });
  });

  it('retries only server and network errors', () => {
    const retry = createQueryClient().getDefaultOptions().queries?.retry as (count: number, error: unknown) => boolean;
    expect(retry(0, new ApiError('INTERNAL_ERROR', 'x', 500))).toBe(true);
    expect(retry(0, new ApiError('NETWORK_ERROR', 'x', 0))).toBe(true);
    expect(retry(0, new ApiError('NOT_FOUND', 'x', 404))).toBe(false);
    expect(retry(2, new ApiError('INTERNAL_ERROR', 'x', 500))).toBe(false);
    expect(retry(0, new Error('x'))).toBe(true);
  });
});

describe('copyText', () => {
  it('uses the async clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    expect(await copyText('123456')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('123456');
  });

  it('falls back to execCommand', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    document.execCommand = vi.fn(() => true);
    expect(await copyText('abc')).toBe(true);
  });
});

describe('icon font subset', () => {
  it('lists every icon once, alphabetically, as Google Fonts requires for icon_names', () => {
    const names = iconFontNames().split(',');
    expect(names).toEqual([...new Set(names)].sort());
    expect(names).toEqual(expect.arrayContaining(['check', 'key', 'account_balance', 'grid_view']));
  });

  it('injects the subset into the font URL in index.html', () => {
    const html = '<link href="https://fonts.googleapis.com/css2?family=X&icon_names=%MATERIAL_SYMBOLS%&display=block" />';
    expect(injectIconNames(html)).toContain(`icon_names=${iconFontNames()}&display=block`);
  });

  it('falls back to a bundled icon for unknown names from the API', () => {
    expect(toIconName('sports_esports')).toBe('sports_esports');
    expect(toIconName('rocket_launch')).toBe(FALLBACK_ICON);
  });
});
