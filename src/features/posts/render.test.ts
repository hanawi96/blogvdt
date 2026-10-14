import { describe, expect, it } from 'vitest';
import { renderPostHtml } from './render';

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
          ],
        },
        { type: 'image', attrs: { src: '/media/2026/10/a.png', alt: 'Tơ tằm', caption: 'Chú thích <x>' } },
        { type: 'image', attrs: { src: 'https://example.com/a.png', alt: 'Ngoài' } },
      ],
    });
    expect(html).toContain('<h2 id="cach-nhin-to">Cách nhìn &lt;tơ&gt;</h2>');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="https://example.com/bai"');
    expect(html).toContain('src="/media/2026/10/a.png"');
    expect(html).toContain('<figcaption>Chú thích &lt;x&gt;</figcaption>');
    expect(html).not.toContain('example.com/a.png');
  });
});
