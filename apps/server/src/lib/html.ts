const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

const HTML_UNESCAPES: Record<string, string> = Object.fromEntries(
  Object.entries(HTML_ESCAPES).map(([char, entity]) => [entity, char]),
);

/** Escapes text for Telegram `parse_mode: HTML` and plain HTML pages. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => HTML_ESCAPES[char] ?? char);
}

/** Reverses our own Telegram HTML into plain text (for logs): drops tags, decodes escapeHtml's entities. */
export function htmlToText(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&(?:amp|lt|gt|quot);/g, (entity) => HTML_UNESCAPES[entity] ?? entity);
}
