import { Fragment } from 'react';

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

type Props = {
  text: string;
};

/**
 * Instruction copy with the names to tap highlighted, so the buyer finds the same button on the
 * order screen. The quotes stay in the text for screen readers and copy-paste, hidden visually.
 */
export function RichText({ text }: Props) {
  return (
    <>
      {splitQuoted(text).map((segment, index) =>
        segment.isChip ? (
          <strong
            key={index}
            className="rounded-md bg-primary-container/20 px-1.5 py-px font-semibold text-primary box-decoration-clone"
          >
            <span className="sr-only">«</span>
            {segment.text}
            <span className="sr-only">»</span>
          </strong>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}
