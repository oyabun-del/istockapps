export type PluralForms = readonly [one: string, few: string, many: string];

/** 1 заказ, 2 заказа, 5 заказов. */
export function pluralRu(count: number, [one, few, many]: PluralForms): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** 1 приложение, 2 приложения, 5 приложений. */
export function formatAppCount(count: number): string {
  // Non-breaking: a line must not end with a bare number.
  return `${count} ${pluralRu(count, ['приложение', 'приложения', 'приложений'])}`;
}
