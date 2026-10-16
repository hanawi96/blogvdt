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
                  { type: 'link', attrs: { href: '/kien-thuc/bai-noi-bo' } },
                  { type: 'link', attrs: { href: 'javascript:alert(1)' } },
                  { type: 'link', attrs: { href: '/kien-thuc/../admin' } },
                ],
              },
            ],
          },
          { type: 'image', attrs: { src: '/media/2026/10/a.webp', alt: 'Vòng', caption: '  Chú thích <x>  ' } },
          { type: 'image', attrs: { src: 'https://evil.example/a.webp' } },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.json).toContain('https://example.com/bai');
    expect(result.json).toContain('/kien-thuc/bai-noi-bo');
    expect(result.json).not.toContain('javascript:');
    expect(result.json).not.toContain('/kien-thuc/../admin');
    expect(result.json).toContain('/media/2026/10/a.webp');
    expect(result.json).toContain('Chú thích <x>');
    expect(result.json).not.toContain('evil.example');
  });

  it('schema editor khớp allowlist lúc lưu', () => {
    const schema = getSchema(postExtensions());
    expect(Object.keys(schema.nodes).sort()).toEqual([...NODE_TYPES].sort());
    expect(Object.keys(schema.marks).sort()).toEqual([...MARK_TYPES].sort());
  });

  it('giữ hộp bài liên quan theo id và bỏ hộp rỗng', () => {
    const result = sanitizePostContent(
      JSON.stringify({
        type: 'doc',
        content: [
          { type: 'postCards', attrs: { ids: [1, 1, 2, 0], labels: ['Một', 'Hai', 'Ba'] } },
          { type: 'postCards', attrs: { ids: [] } },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const doc = JSON.parse(result.json) as { content: Array<{ type: string; attrs?: { ids: number[]; labels: string[] } }> };
    expect(doc.content).toHaveLength(1);
    expect(doc.content[0]?.type).toBe('postCards');
    expect(doc.content[0]?.attrs?.ids).toEqual([1, 2]);
    expect(doc.content[0]?.attrs?.labels).toEqual(['Một', 'Hai']);
  });

  it('từ chối chuỗi không phải JSON của bài', () => {
    expect(sanitizePostContent('<p>html</p>').ok).toBe(false);
    expect(isHttpUrl('https://example.com')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isMediaSrc('/media/2026/10/a.webp')).toBe(true);
    expect(isMediaSrc('/media/../secret')).toBe(false);
  });
});
