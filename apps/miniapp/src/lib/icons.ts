/**
 * Every Material Symbols glyph the app renders. The font is requested with only these
 * glyphs (`icon_names`), which shrinks it from ~4 MB to a few KB, so an icon missing
 * here would render as plain text: `IconName` makes that a type error.
 */
export const ICON_NAMES = [
  'account_balance',
  'apps',
  'arrow_back',
  'auto_fix_high',
  'campaign',
  'cancel',
  'check',
  'check_circle',
  'chevron_right',
  'content_copy',
  'credit_card',
  'currency_bitcoin',
  'currency_exchange',
  'description',
  'download',
  'download_done',
  'download_for_offline',
  'edit_note',
  'error',
  'expand_more',
  'grid_view',
  'help',
  'key',
  'lock',
  'menu_book',
  'open_in_new',
  'person',
  'qr_code_2',
  'refresh',
  'report',
  'schedule',
  'search',
  'search_off',
  'send',
  'settings',
  'sms',
  'sports_esports',
  'subdirectory_arrow_right',
  'support_agent',
  'task_alt',
  'timer_off',
  'undo',
  'verified',
  'verified_user',
  'visibility',
  'visibility_off',
  'warning',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

/** Shown for category icons from the catalog API that are not in the subset. */
export const FALLBACK_ICON: IconName = 'grid_view';

const ICON_SET: ReadonlySet<string> = new Set(ICON_NAMES);
const ICON_NAMES_PLACEHOLDER = '%MATERIAL_SYMBOLS%';

export function isIconName(value: string): value is IconName {
  return ICON_SET.has(value);
}

/** Icon names coming from the server are not checked at compile time. */
export function toIconName(value: string): IconName {
  return isIconName(value) ? value : FALLBACK_ICON;
}

/** Google Fonts requires `icon_names` to be sorted alphabetically. */
export function iconFontNames(): string {
  return [...ICON_SET].sort().join(',');
}

/** Used by the Vite build to fill the font URL in index.html. */
export function injectIconNames(html: string): string {
  return html.replaceAll(ICON_NAMES_PLACEHOLDER, iconFontNames());
}
