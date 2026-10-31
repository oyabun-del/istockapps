export const LEGAL_DOC_IDS = ['terms', 'privacy'] as const;
export type LegalDocId = (typeof LEGAL_DOC_IDS)[number];

/** Mini App routes of the documents; the bot links to them too. */
export const LEGAL_PATHS: Record<LegalDocId, string> = {
  terms: '/legal/terms',
  privacy: '/legal/privacy',
};
