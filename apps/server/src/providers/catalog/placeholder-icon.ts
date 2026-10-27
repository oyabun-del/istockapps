const DEFAULT_FROM = '#3a4a6b';
const DEFAULT_TO = '#1f2a40';

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** Gradient tile with a letter: used when the catalog API has no icon for an app. */
export function placeholderIcon(label: string, from = DEFAULT_FROM, to = DEFAULT_TO): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>` +
    `<rect width="120" height="120" fill="url(#g)"/>` +
    `<text x="60" y="76" font-family="Inter,Arial,sans-serif" font-size="46" font-weight="700" ` +
    `fill="#fff" text-anchor="middle">${escapeXml(label)}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** First letter of the app name, upper-cased; "?" for an empty name. */
export function initialOf(name: string): string {
  const first = [...name.trim()][0];
  return first ? first.toLocaleUpperCase('ru-RU') : '?';
}
