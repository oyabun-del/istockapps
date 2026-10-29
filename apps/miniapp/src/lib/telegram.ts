/**
 * Thin wrapper over window.Telegram.WebApp (https://core.telegram.org/bots/webapps).
 * Every function degrades gracefully in a regular browser (local development).
 */

type HapticImpact = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';
type HapticNotification = 'error' | 'success' | 'warning';

interface TelegramBackButton {
  show(): void;
  hide(): void;
  onClick(callback: () => void): void;
  offClick(callback: () => void): void;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: { id: number; first_name: string; last_name?: string; username?: string; photo_url?: string };
    start_param?: string;
  };
  version: string;
  ready(): void;
  expand(): void;
  isVersionAtLeast(version: string): boolean;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  setBottomBarColor?(color: string): void;
  disableVerticalSwipes?(): void;
  openLink(url: string, options?: { try_instant_view?: boolean }): void;
  openTelegramLink(url: string): void;
  BackButton: TelegramBackButton;
  HapticFeedback: {
    impactOccurred(style: HapticImpact): void;
    notificationOccurred(type: HapticNotification): void;
    selectionChanged(): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

const SURFACE_COLOR = '#10131a';

export function getWebApp(): TelegramWebApp | null {
  const webApp = typeof window === 'undefined' ? undefined : window.Telegram?.WebApp;
  // The script defines WebApp even outside Telegram; initData is empty there.
  return webApp && webApp.initData ? webApp : null;
}

function supports(webApp: TelegramWebApp, version: string): boolean {
  try {
    return webApp.isVersionAtLeast(version);
  } catch {
    return false;
  }
}

export function initTelegram(): void {
  const webApp = getWebApp();
  if (!webApp) return;
  webApp.ready();
  webApp.expand();
  if (supports(webApp, '6.1')) {
    webApp.setHeaderColor(SURFACE_COLOR);
    webApp.setBackgroundColor(SURFACE_COLOR);
  }
  if (supports(webApp, '7.10')) webApp.setBottomBarColor?.(SURFACE_COLOR);
  if (supports(webApp, '7.7')) webApp.disableVerticalSwipes?.();
}

export function getInitData(): string {
  return getWebApp()?.initData ?? '';
}

export interface TelegramProfile {
  firstName: string;
  username: string | null;
  photoUrl: string | null;
}

export function getTelegramProfile(): TelegramProfile | null {
  const user = getWebApp()?.initDataUnsafe.user;
  if (!user) return null;
  return { firstName: user.first_name, username: user.username ?? null, photoUrl: user.photo_url ?? null };
}

export function getStartParam(): string | null {
  return getWebApp()?.initDataUnsafe.start_param ?? null;
}

/** Only web pages leave the Mini App; plain http is kept for local development. */
function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || (import.meta.env.DEV && protocol === 'http:');
  } catch {
    return false;
  }
}

/** External links (payment page, downloads) open in the system browser. */
export function openExternalLink(url: string): void {
  if (!isWebUrl(url)) return;
  const webApp = getWebApp();
  if (webApp) webApp.openLink(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

/** t.me links (support, channel) open inside Telegram. */
export function openTelegramLink(url: string): void {
  const webApp = getWebApp();
  if (webApp && url.startsWith('https://t.me/')) webApp.openTelegramLink(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

export function hapticImpact(style: HapticImpact = 'light'): void {
  getWebApp()?.HapticFeedback.impactOccurred(style);
}

export function hapticNotify(type: HapticNotification): void {
  getWebApp()?.HapticFeedback.notificationOccurred(type);
}

export function showBackButton(onBack: () => void): () => void {
  const button = getWebApp()?.BackButton;
  if (!button) return () => undefined;
  button.onClick(onBack);
  button.show();
  return () => {
    button.offClick(onBack);
    button.hide();
  };
}
