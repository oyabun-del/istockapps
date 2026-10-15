const KOPECKS_IN_RUBLE = 100;

/** 34900 → "349 ₽", 34950 → "349,50 ₽" */
export function formatRub(kopecks: number): string {
  const rubles = kopecks / KOPECKS_IN_RUBLE;
  const hasFraction = kopecks % KOPECKS_IN_RUBLE !== 0;
  const formatted = rubles.toLocaleString('ru-RU', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return `${formatted.replace(/ /g, ' ')} ₽`;
}

export function rubToKopecks(rub: number): number {
  return Math.round(rub * KOPECKS_IN_RUBLE);
}
