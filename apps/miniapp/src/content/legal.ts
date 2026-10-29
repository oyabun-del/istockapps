import type { SellerDto } from '@istock/shared';
import { PRIVACY_SECTIONS, PRIVACY_TITLE, privacyIntro } from './privacy';
import { TERMS_SECTIONS, TERMS_TITLE, termsIntro } from './terms';

/** Change together with the texts in terms.ts and privacy.ts. */
export const LEGAL_EDITION = '29 октября 2026 г.';

export const LEGAL_DOC_IDS = ['terms', 'privacy'] as const;
export type LegalDocId = (typeof LEGAL_DOC_IDS)[number];

export const LEGAL_PATHS: Record<LegalDocId, string> = {
  terms: '/legal/terms',
  privacy: '/legal/privacy',
};

export const LEGAL_TITLES: Record<LegalDocId, string> = {
  terms: TERMS_TITLE,
  privacy: PRIVACY_TITLE,
};

export interface LegalSection {
  title: string;
  paragraphs: readonly string[];
}

export interface LegalDocument {
  title: string;
  intro: string;
  sections: readonly LegalSection[];
}

/** Seller details are required in production; this only shows up in development. */
const SELLER_FALLBACK = 'ИП (реквизиты не указаны)';

export function isLegalDocId(value: string | undefined): value is LegalDocId {
  return LEGAL_DOC_IDS.some((id) => id === value);
}

export function legalDocument(id: LegalDocId, seller: SellerDto | null): LegalDocument {
  const sellerName = seller?.name ?? SELLER_FALLBACK;
  if (id === 'terms') return { title: LEGAL_TITLES.terms, intro: termsIntro(sellerName), sections: TERMS_SECTIONS };
  return { title: LEGAL_TITLES.privacy, intro: privacyIntro(sellerName), sections: PRIVACY_SECTIONS };
}
