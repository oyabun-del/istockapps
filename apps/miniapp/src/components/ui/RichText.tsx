import { Fragment } from 'react';
import { APP_STORE_SECTION } from '../../content/guide';
import { AppStoreIcon } from './AppStoreIcon';

type Segment = { text: string; isChip: boolean };

/** «Label» in the copy names a button or a Settings item: it is shown as a chip. */
const QUOTED = /«([^«»]+)»/g;

function splitQuoted(text: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(QUOTED)) {
    if (match.index > cursor) segments.push({ text: text.slice(cursor, match.index), isChip: false });
    segments.push({ text: match[1] ?? '', isChip: true });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), isChip: false });
  return segments;
}

/** The App Store section carries its iOS icon, so the buyer spots the same row in Settings. */
function Chip({ label }: { label: string }) {
  return (
    <strong className="whitespace-nowrap rounded-md bg-primary-container/20 px-1.5 py-px font-semibold text-primary">
      {label === APP_STORE_SECTION && <AppStoreIcon className="mr-1 align-[-0.2em]" />}
      <span className="sr-only">«</span>
      {label}
      <span className="sr-only">»</span>
    </strong>
  );
}

type Props = {
  text: string;
};

/**
 * Instruction copy with the names to tap highlighted, so the buyer finds the same button on the
 * order screen. A chip never breaks across lines: it moves to the next line whole. The quotes stay in the text for screen readers and copy-paste, hidden visually.
 */
export function RichText({ text }: Props) {
  return (
    <>
      {splitQuoted(text).map((segment, index) =>
        segment.isChip ? (
          <Chip key={index} label={segment.text} />
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}
