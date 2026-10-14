import { getSchema } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { isHttpUrl } from '../../lib/http';
import { isMediaSrc, MARK_TYPES, NODE_TYPES, sanitizePostContent } from './content';
import { postExtensions } from './extensions';

describe('nội dung bài viết', () => {
  it('giữ liên kết http và ảnh trong thư viện', () => {
    const result = sanitizePostContent(
      JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Xem',
                marks: [
                  { type: 'link', attrs: { href: 'https://example.com/bai' } },
                  { type: 'link', attrs: { href: 'javascript:alert(1)' } },
                ],
              },
            ],
          },
          { type: 'image', attrs: { src: '/media/2026/10/a.webp', alt: 'Vòng' } },
          { type: 'image', attrs: { src: 'https://evil.example/a.webp' } },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.json).toContain('https://example.com/bai');
    expect(result.json).not.toContain('javascript:');
    expect(result.json).toContain('/media/2026/10/a.webp');
    expect(result.json).not.toContain('evil.example');
  });

  it('schema editor khớp allowlist lúc lưu', () => {
    const schema = getSchema(postExtensions());
    expect(Object.keys(schema.nodes).sort()).toEqual([...NODE_TYPES].sort());
    expect(Object.keys(schema.marks).sort()).toEqual([...MARK_TYPES].sort());
  });

  it('từ chối chuỗi không phải JSON của bài', () => {
    expect(sanitizePostContent('<p>html</p>').ok).toBe(false);
    expect(isHttpUrl('https://example.com')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isMediaSrc('/media/2026/10/a.webp')).toBe(true);
    expect(isMediaSrc('/media/../secret')).toBe(false);
  });
});
