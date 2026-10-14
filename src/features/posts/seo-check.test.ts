import { describe, expect, it } from 'vitest';
import { checkPostSeo, lengthNote, SEO_TITLE_RANGE } from './seo-check';

const base = {
  title: 'Nên hỏi gì khi đặt vòng cho bé',
  slug: 'nen-hoi-gi-khi-dat-vong-cho-be',
  slugCheck: 'free' as const,
  seoTitle: '',
  metaDescription: 'Cỡ vòng, màu chỉ và thời gian nhận hàng khi đặt vòng tơ tằm thủ công cho bé.',
  excerpt: '',
  contentJson: JSON.stringify({
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Khi đặt' }] },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Xem thêm',
            marks: [{ type: 'link', attrs: { href: '/kien-thuc/cac-buoc-lam-vong' } }],
          },
        ],
      },
      { type: 'image', attrs: { src: '/media/2026/10/a.webp', alt: 'Vòng tơ' } },
    ],
  }),
  hasCover: true,
  coverAlt: 'Ảnh bìa',
  publishedAt: 1,
  siteName: 'Vòng Dâu Tằm',
  host: 'localhost',
};

describe('kiểm tra SEO', () => {
  it('bài đủ dữ liệu thì các mục chính đạt', () => {
    const states = Object.fromEntries(checkPostSeo(base).map((check) => [check.id, check.state]));
    expect(states.title).toBe('pass');
    expect(states.slug).toBe('pass');
    expect(states.content).toBe('pass');
    expect(states['seo-title']).toBe('pass');
    expect(states.description).toBe('pass');
    expect(states.cover).toBe('pass');
    expect(states.alt).toBe('pass');
    expect(states.headings).toBe('pass');
    expect(states.links).toBe('pass');
    expect(states.author).toBe('pass');
  });

  it('thiếu dữ liệu thì lỗi và gợi ý tách riêng, slug trùng là lỗi', () => {
    const checks = checkPostSeo({
      ...base,
      title: '',
      slug: 'nen-hoi',
      slugCheck: 'taken',
      seoTitle: '',
      metaDescription: '',
      excerpt: '',
      contentJson: '{"type":"doc","content":[]}',
      hasCover: false,
      coverAlt: '',
      publishedAt: null,
    });
    const byId = Object.fromEntries(checks.map((check) => [check.id, check]));
    expect(byId.title?.state).toBe('error');
    expect(byId.slug?.state).toBe('error');
    expect(byId.content?.state).toBe('error');
    expect(byId.cover?.state).toBe('improve');
    expect(byId.links?.state).toBe('na');
    expect(byId.author?.state).toBe('pass');
  });

  it('tiêu đề 3 đứng trước tiêu đề 2 và ảnh thiếu mô tả thì cần cải thiện', () => {
    const checks = checkPostSeo({
      ...base,
      seoTitle: 'Ngắn',
      contentJson: JSON.stringify({
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Mục nhỏ' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Đoạn chữ.' }] },
          { type: 'image', attrs: { src: '/media/a.webp', alt: '' } },
        ],
      }),
    });
    const byId = Object.fromEntries(checks.map((check) => [check.id, check]));
    expect(byId['seo-title']?.state).toBe('improve');
    expect(byId.headings?.detail).toContain('Tiêu đề 3');
    expect(byId.alt?.state).toBe('improve');
    expect(byId.links?.state).toBe('improve');
  });

  it('đếm độ dài chỉ cảnh báo, không biến chuỗi rỗng thành cảnh báo', () => {
    expect(lengthNote(0, SEO_TITLE_RANGE.min, SEO_TITLE_RANGE.max)).toBe('');
    expect(lengthNote(10, SEO_TITLE_RANGE.min, SEO_TITLE_RANGE.max)).toContain('Hơi ngắn');
    expect(lengthNote(80, SEO_TITLE_RANGE.min, SEO_TITLE_RANGE.max)).toContain('Hơi dài');
    expect(lengthNote(40, SEO_TITLE_RANGE.min, SEO_TITLE_RANGE.max)).toBe('');
  });
});
