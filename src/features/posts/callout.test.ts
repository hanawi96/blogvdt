import { describe, expect, it } from 'vitest';
import { normalizeCalloutVariant, renderCalloutHtml } from './callout';
import { sanitizePostContent } from './content';

describe('callout', () => {
  it('chuẩn hóa variant và render nhãn', () => {
    expect(normalizeCalloutVariant('safety')).toBe('safety');
    expect(normalizeCalloutVariant('nope')).toBe('tip');
    const html = renderCalloutHtml('folk', '<p>Tin truyền miệng chưa phải bằng chứng.</p>');
    expect(html).toContain('Dân gian vs khoa học');
    expect(html).toContain('callout-folk');
    expect(html).toContain('Tin truyền miệng');
  });

  it('sanitize giữ callout + productCards', () => {
    const result = sanitizePostContent(
      JSON.stringify({
        type: 'doc',
        content: [
          { type: 'callout', attrs: { variant: 'safety' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'An toàn' }] }] },
          { type: 'productCards', attrs: { ids: [9], labels: ['Vòng'], covers: ['/media/v.jpg', 'https://evil'] } },
          { type: 'productCards', attrs: { ids: [] } },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const doc = JSON.parse(result.json) as { content: Array<{ type: string; attrs?: Record<string, unknown> }> };
    expect(doc.content.map((n) => n.type)).toEqual(['callout', 'productCards']);
    expect(doc.content[0]?.attrs?.variant).toBe('safety');
    expect(doc.content[1]?.attrs?.ids).toEqual([9]);
    expect(doc.content[1]?.attrs?.covers).toEqual(['/media/v.jpg']);
  });
});
