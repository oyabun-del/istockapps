const KOPECKS_IN_RUBLE = 100;
/** Glues an amount together: "1 250 ₽" broken after "1" reads as 250 ₽. */
const NBSP = '\u00a0';

/** 34900 → "349 ₽", 34950 → "349,50 ₽", 125000 → "1 250 ₽"; the spaces are non-breaking. */
export function formatRub(kopecks: number): string {
  const rubles = kopecks / KOPECKS_IN_RUBLE;
  const hasFraction = kopecks % KOPECKS_IN_RUBLE !== 0;
  const formatted = rubles.toLocaleString('ru-RU', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return `${formatted.replace(/\s/g, NBSP)}${NBSP}₽`;
}

export function rubToKopecks(rub: number): number {
  return Math.round(rub * KOPECKS_IN_RUBLE);
}
