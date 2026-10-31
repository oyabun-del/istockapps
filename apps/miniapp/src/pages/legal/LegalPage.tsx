import type { SellerDto } from '@istock/shared';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Page } from '../../components/layout/Page';
import { Icon } from '../../components/ui/Icon';
import {
  LEGAL_EDITION,
  LEGAL_PATHS,
  LEGAL_TITLES,
  isLegalDocId,
  legalDocument,
  type LegalDocId,
  type LegalSection,
} from '../../content/legal';
import { useMe } from '../../lib/queries';

const OTHER_DOC: Record<LegalDocId, LegalDocId> = { terms: 'privacy', privacy: 'terms' };

function Section({ section }: { section: LegalSection }) {
  return (
    <section className="flex flex-col gap-space-sm rounded-xl bg-surface-container p-space-lg">
      <h2 className="text-headline-sm text-on-surface">{section.title}</h2>
      {section.paragraphs.map((paragraph) => (
        <p key={paragraph} className="text-body-sm text-on-surface-variant">
          {paragraph}
        </p>
      ))}
    </section>
  );
}

function SellerDetails({ seller }: { seller: SellerDto | null }) {
  return (
    <section aria-labelledby="seller-heading" className="flex flex-col gap-1 rounded-xl bg-surface-container-high p-space-lg">
      <h2 id="seller-heading" className="mb-1 text-headline-sm text-on-surface">
        Контакты
      </h2>
      {seller ? (
        <>
          <p className="text-label-lg text-on-surface">{seller.name}</p>
          <a href={`mailto:${seller.email}`} className="text-body-sm text-primary">
            {seller.email}
          </a>
        </>
      ) : (
        <p className="text-body-sm text-on-surface-variant">Контакты пока не указаны</p>
      )}
    </section>
  );
}

export function LegalPage() {
  const { doc } = useParams();
  const { data: me } = useMe();
  if (!isLegalDocId(doc)) return <Navigate to="/" replace />;

  const content = legalDocument(doc, me?.seller ?? null);
  const otherDoc = OTHER_DOC[doc];

  return (
    <Page subtitle="Документы" hasBackButton hasBottomNav={false}>
      <div className="flex flex-col gap-space-md">
        <section className="rounded-xl bg-surface-container-high p-space-lg">
          <h1 className="text-balance text-headline-lg tracking-tight text-on-surface">{content.title}</h1>
          <p className="mt-1 text-label-md text-outline">Редакция от {LEGAL_EDITION}</p>
          <p className="mt-space-sm text-body-sm text-on-surface-variant">{content.intro}</p>
        </section>

        {content.sections.map((section) => (
          <Section key={section.title} section={section} />
        ))}

        {me && <SellerDetails seller={me.seller} />}

        <Link
          to={LEGAL_PATHS[otherDoc]}
          className="flex items-center justify-between rounded-xl bg-surface-container px-space-lg py-3.5 text-label-lg text-on-surface transition-colors hover:bg-surface-container-high"
        >
          {LEGAL_TITLES[otherDoc]}
          <Icon name="chevron_right" className="text-[20px] text-outline" />
        </Link>
      </div>
    </Page>
  );
}
