import { describe, expect, it } from 'vitest';
import { escapeHtml, htmlToText } from './html.js';

describe('htmlToText', () => {
  it('drops tags and decodes what escapeHtml encoded', () => {
    const html = `<b>${escapeHtml('AT&T <Pro> "Plus"')}</b>\n<a href="https://x">ссылка</a>`;

    expect(htmlToText(html)).toBe('AT&T <Pro> "Plus"\nссылка');
  });

  it('decodes &amp;lt; once, not twice', () => {
    expect(htmlToText(escapeHtml('&lt;'))).toBe('&lt;');
  });
});
