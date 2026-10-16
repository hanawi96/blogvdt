import { describe, expect, it } from 'vitest';
import { renderPostHtml } from './render';
import type { PostCardEmbed } from './post-cards';

describe('render HTML bài viết', () => {
  it('giữ chữ, heading có id, và bỏ liên kết lạ cùng ảnh ngoài thư viện', () => {
    const html = renderPostHtml({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Cách nhìn <tơ>' }],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Xem',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
            {
              type: 'text',
              text: ' bài',
              marks: [{ type: 'link', attrs: { href: 'https://example.com/bai' } }],
            },
            {
              type: 'text',
              text: ' nội bộ',
              marks: [{ type: 'link', attrs: { href: '/kien-thuc/bai-noi-bo' } }],
            },
          ],
        },
        { type: 'image', attrs: { src: '/media/2026/10/a.png', alt: 'Tơ tằm', caption: 'Chú thích <x>' } },
        { type: 'image', attrs: { src: 'https://example.com/a.png', alt: 'Ngoài' } },
      ],
    });
    expect(html).toContain('<h2 id="cach-nhin-to">Cách nhìn &lt;tơ&gt;</h2>');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="https://example.com/bai"');
    expect(html).toContain('href="/kien-thuc/bai-noi-bo"');
    expect(html).toContain('src="/media/2026/10/a.png"');
    expect(html).not.toContain('width=');
    expect(html).toContain('<figcaption>Chú thích &lt;x&gt;</figcaption>');
    expect(html).not.toContain('example.com/a.png');
  });

  it('gắn kích thước ảnh khi thư viện có số đo', () => {
    const html = renderPostHtml(
      { type: 'doc', content: [{ type: 'image', attrs: { src: '/media/2026/10/a.png', alt: 'Tơ' } }] },
      new Map([['/media/2026/10/a.png', { width: 800, height: 600 }]]),
    );
    expect(html).toContain('width="800"');
    expect(html).toContain('height="600"');
    expect(html).toContain('loading="lazy"');
  });

  it('render hộp bài liên quan theo id đã resolve', () => {
    const cardsById = new Map<number, PostCardEmbed>([
      [
        5,
        {
          id: 5,
          title: 'Chọn chỉ an toàn',
          slug: 'chon-chi-an-toan',
          excerpt: '',
          categoryName: 'Cách chọn vòng',
          coverUrl: null,
          coverAlt: '',
          coverWidth: null,
          coverHeight: null,
        },
      ],
    ]);
    const html = renderPostHtml(
      {
        type: 'doc',
        content: [{ type: 'postCards', attrs: { ids: [5, 99], labels: ['Chọn chỉ an toàn', 'Mất'] } }],
      },
      new Map(),
      { cardsById },
    );
    expect(html).toContain('class="post-cards"');
    expect(html).toContain('href="/kien-thuc/chon-chi-an-toan"');
    expect(html).toContain('Chọn chỉ an toàn');
    expect(html).not.toContain('Mất');
  });

  it('ảnh đầu không lazy khi bài không có ảnh đại diện, ảnh hỏng bị bỏ', () => {
    const html = renderPostHtml(
      {
        type: 'doc',
        content: [
          { type: 'image', attrs: { src: '/media/2026/10/a.webp', alt: '' } },
          { type: 'image', attrs: { src: '/media/2026/10/b.webp', alt: 'Chi tiết chỉ' } },
          { type: 'image', attrs: { src: '/media/missing.webp', alt: 'Mất' } },
        ],
      },
      new Map([['/media/2026/10/b.webp', { width: 640, height: 480 }]]),
      { skip: new Set(['/media/missing.webp']), eager: 1 },
    );
    expect(html).toContain('src="/media/2026/10/a.webp" alt="" fetchpriority="high"');
    expect(html).not.toContain('src="/media/2026/10/a.webp" alt="" fetchpriority="high" loading="lazy"');
    expect(html).toContain('src="/media/2026/10/b.webp"');
    expect(html).toContain('loading="lazy"');
    expect(html).not.toContain('missing.webp');
  });
});
