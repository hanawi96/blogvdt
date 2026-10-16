import { describe, expect, it } from 'vitest';
import { blogPostingSchema, breadcrumbSchema, buildMeta, canonicalUrl, categoryPageMeta, documentTitle, homePageMeta, jsonLd, knowledgeListMeta, KNOWLEDGE_LIST_DESCRIPTION, plainMetaText, postPageMeta, productSchema, shareImageUrl, shareMetadata, shareOriginFrom, siteOrigin, tagPageMeta } from './meta';

describe('SEO', () => {
  it('ghép canonical từ origin và đường dẫn', () => {
    const meta = buildMeta('http://localhost:4321/', {
      title: 'Bài',
      description: 'Mô tả',
      path: '/kien-thuc/bai',
      image: '/media/2026/10/a.png',
    });
    expect(meta.canonical).toBe('http://localhost:4321/kien-thuc/bai');
    expect(meta.image).toBe('http://localhost:4321/media/2026/10/a.png');
  });

  it('canonical dùng domain đã cấu hình, https và bỏ tham số theo dõi', () => {
    expect(siteOrigin('http://localhost:4321', 'https://VongDauTam.vn/')).toBe('https://vongdautam.vn');
    expect(siteOrigin('http://vongdautam.vn')).toBe('https://vongdautam.vn');
    expect(canonicalUrl('https://vongdautam.vn', '/kien-thuc/?utm_source=zalo&fbclid=1')).toBe('https://vongdautam.vn/kien-thuc');
    expect(canonicalUrl('https://vongdautam.vn', '/kien-thuc?page=1&utm_campaign=a')).toBe('https://vongdautam.vn/kien-thuc');
    expect(canonicalUrl('https://vongdautam.vn', '/kien-thuc/danh-muc/goc-chia-se?page=2&utm_source=fb')).toBe('https://vongdautam.vn/kien-thuc/danh-muc/goc-chia-se?page=2');
    expect(canonicalUrl('https://vongdautam.vn', '/')).toBe('https://vongdautam.vn/');
    expect(canonicalUrl('https://vongdautam.vn', '/kien-thuc/nh%C3%ACn')).toBe('https://vongdautam.vn/kien-thuc/nh%C3%ACn');
    expect(canonicalUrl('https://vongdautam.vn', '/kien-thuc/a%20%26%20b')).toBe('https://vongdautam.vn/kien-thuc/a%20%26%20b');
    expect(canonicalUrl('https://vongdautam.vn', '/kien-thuc/../admin')).toBe('');
    expect(canonicalUrl('https://evil.example', 'javascript:alert(1)')).toBe('');
  });

  it('schema bài viết chỉ ghi dữ liệu có thật', () => {
    const schema = blogPostingSchema({
      headline: 'Bài',
      description: 'Mô tả',
      canonical: 'http://localhost:4321/kien-thuc/bai',
      image: null,
      publishedTime: '2026-10-01T00:00:00.000Z',
      siteName: 'Vòng Dâu Tằm',
      logo: null,
    });
    expect(schema?.['@type']).toBe('BlogPosting');
    expect(schema?.url).toBe('http://localhost:4321/kien-thuc/bai');
    expect(schema?.datePublished).toBe('2026-10-01T00:00:00.000Z');
    expect(schema).not.toHaveProperty('dateModified');
    expect(schema).not.toHaveProperty('image');
    expect(schema).not.toHaveProperty('aggregateRating');
    expect(schema).not.toHaveProperty('review');
    expect(schema?.author).toMatchObject({ '@type': 'Organization', name: 'Vòng Dâu Tằm' });
    const pictured = blogPostingSchema({
      headline: 'Bài',
      description: 'Mô tả',
      canonical: 'http://localhost:4321/kien-thuc/bai',
      image: { url: 'http://localhost:4321/media/a.png', width: 800, height: 600 },
      publishedTime: '2026-10-02T00:00:00.000Z',
      modifiedTime: '2026-10-01T00:00:00.000Z',
      siteName: 'Vòng Dâu Tằm',
    });
    expect(pictured?.image).toEqual({ '@type': 'ImageObject', url: 'http://localhost:4321/media/a.png', width: 800, height: 600 });
    expect(pictured).not.toHaveProperty('dateModified');
    const authored = blogPostingSchema({
      headline: 'Bài',
      description: 'Mô tả',
      canonical: 'http://localhost:4321/kien-thuc/bai',
      siteName: 'Vòng Dâu Tằm',
      authorUrl: 'http://localhost:4321/',
      author: { name: 'Nguyễn An', url: 'https://facebook.com/an', image: 'https://cdn.test/a.png' },
    });
    expect(authored?.author).toEqual({ '@type': 'Person', name: 'Nguyễn An', url: 'https://facebook.com/an', image: 'https://cdn.test/a.png' });
    const authoredNoLinks = blogPostingSchema({
      headline: 'Bài',
      description: 'Mô tả',
      canonical: 'http://localhost:4321/kien-thuc/bai',
      siteName: 'Vòng Dâu Tằm',
      author: { name: 'Nguyễn An', url: 'javascript:alert(1)', image: null },
    });
    expect(authoredNoLinks?.author).toEqual({ '@type': 'Person', name: 'Nguyễn An' });
    expect(blogPostingSchema({
      headline: 'Bài',
      description: 'Mô tả',
      canonical: 'javascript:alert(1)',
      siteName: 'Vòng Dâu Tằm',
    })).toBeNull();
    expect(jsonLd(schema ?? {})).not.toContain('<');
  });

  it('breadcrumb dùng URL canonical và bỏ schema khi thiếu đường dẫn', () => {
    const trail = breadcrumbSchema('http://localhost:4321', [
      { name: 'Trang chủ', path: '/' },
      { name: 'Kiến thức', path: '/kien-thuc' },
      { name: 'Bài', path: '/kien-thuc/bai' },
    ]);
    expect(trail?.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Trang chủ', item: 'http://localhost:4321/' },
      { '@type': 'ListItem', position: 2, name: 'Kiến thức', item: 'http://localhost:4321/kien-thuc' },
      { '@type': 'ListItem', position: 3, name: 'Bài', item: 'http://localhost:4321/kien-thuc/bai' },
    ]);
    expect(breadcrumbSchema('http://localhost:4321', [{ name: 'Bài', path: '/kien-thuc/../admin' }])).toBeNull();
    expect(blogPostingSchema({
      headline: ' ',
      description: '',
      canonical: '',
      siteName: 'Vòng Dâu Tằm',
    })).toBeNull();
  });

  it('JSON-LD không để ký tự HTML phá thẻ script', () => {
    const encoded = jsonLd({ headline: '</script><img alt="&">' });
    expect(encoded).toContain('\\u003c/script\\u003e');
    expect(encoded).toContain('\\u0026');
    expect(encoded).not.toContain('<');
    expect(encoded).not.toContain('>');
  });

  it('schema sản phẩm chỉ ghi giá và ảnh có thật', () => {
    const schema = productSchema({
      name: 'Vòng tơ tằm trơn',
      description: 'Vòng một màu.',
      canonical: 'http://localhost:4321/san-pham/vong-to-tam-tron',
      image: null,
      price: 150000,
      siteName: 'Vòng Dâu Tằm',
    });
    expect(schema['@type']).toBe('Product');
    expect(schema.offers).toMatchObject({ priceCurrency: 'VND', price: 150000 });
    expect(schema).not.toHaveProperty('aggregateRating');
  });
});

describe('title và description', () => {
  const site = {
    siteName: 'Vòng Dâu Tằm',
    siteDescription: 'Mô tả website.',
    defaultSeoTitle: 'Vòng Dâu Tằm',
    defaultSeoDescription: 'Vòng tơ tằm làm thủ công, theo tập quán tặng bé và gia đình.',
  };

  it('giữ tiếng Việt và ký tự đặc biệt, gộp khoảng trắng', () => {
    expect(plainMetaText('  Bé & "mẹ"\n<script>  ')).toBe('Bé & "mẹ" <script>');
    expect(documentTitle('Chọn vòng | Vòng Dâu Tằm', 'Vòng Dâu Tằm')).toBe('Chọn vòng | Vòng Dâu Tằm');
    expect(documentTitle('Kiến thức', 'Vòng Dâu Tằm', 2)).toBe('Kiến thức — trang 2 | Vòng Dâu Tằm');
  });

  it('mỗi loại trang có mô tả riêng, bài viết ưu tiên ô SEO', () => {
    expect(homePageMeta(site).description).toBe(site.defaultSeoDescription);
    expect(knowledgeListMeta(site.siteName).description).toBe(KNOWLEDGE_LIST_DESCRIPTION);
    expect(knowledgeListMeta(site.siteName).description).not.toBe(homePageMeta(site).description);
    expect(
      postPageMeta({
        title: 'Nhìn một vòng',
        seoTitle: '  ',
        metaDescription: '',
        excerpt: 'Cách xem tơ và màu chỉ.',
        siteName: site.siteName,
      }),
    ).toEqual({ title: 'Nhìn một vòng | Vòng Dâu Tằm', description: 'Cách xem tơ và màu chỉ.' });
    expect(
      postPageMeta({
        title: 'Nhìn một vòng',
        seoTitle: 'Cách nhìn vòng <thủ công>',
        metaDescription: 'Mô tả "SEO" & bé.',
        excerpt: 'Không dùng tóm tắt.',
        siteName: site.siteName,
      }),
    ).toEqual({ title: 'Cách nhìn vòng <thủ công> | Vòng Dâu Tằm', description: 'Mô tả "SEO" & bé.' });
  });

  it('danh mục trống SEO thì dùng tên và mô tả, không lấy mô tả trang chủ', () => {
    expect(categoryPageMeta({ name: 'Cách chọn vòng', description: 'Nhìn chất tơ.', seoTitle: '', metaDescription: '  ' }, 'Vòng dâu')).toEqual({
      title: 'Cách chọn vòng | Vòng dâu',
      description: 'Nhìn chất tơ.',
    });
    expect(categoryPageMeta({ name: 'Cách chọn vòng', description: null, seoTitle: 'Chọn vòng cho bé', metaDescription: 'Mô tả tìm kiếm.' }, 'Vòng dâu')).toEqual({
      title: 'Chọn vòng cho bé | Vòng dâu',
      description: 'Mô tả tìm kiếm.',
    });
    expect(categoryPageMeta({ name: 'Góc chia sẻ', description: null, seoTitle: null, metaDescription: null }, 'Vòng dâu').description).toBe('Bài viết trong danh mục Góc chia sẻ.');
  });

  it('thẻ trống SEO thì dùng tên và mô tả mặc định', () => {
    expect(tagPageMeta({ name: 'Vòng dâu tằm', description: null, seoTitle: null, metaDescription: null }, 'Vòng dâu').description).toBe(
      'Bài viết gắn thẻ Vòng dâu tằm.',
    );
    expect(tagPageMeta({ name: 'Vòng', description: 'Gợi ý chọn.', seoTitle: '', metaDescription: '  ' }, 'Vòng dâu')).toEqual({
      title: 'Vòng | Vòng dâu',
      description: 'Gợi ý chọn.',
    });
  });

  it('metadata chia sẻ dùng canonical và ảnh cùng host', () => {
    expect(shareOriginFrom('https://vongdautam.vn/kien-thuc/bai', 'http://localhost:4321')).toBe('https://vongdautam.vn');
    expect(shareImageUrl('https://vongdautam.vn', '/media/2026/10/a.webp')).toBe('https://vongdautam.vn/media/2026/10/a.webp');
    expect(shareImageUrl('https://vongdautam.vn', 'https://evil.example/media/a.webp')).toBeNull();
    expect(shareImageUrl('https://vongdautam.vn', 'javascript:alert(1)')).toBeNull();
    const share = shareMetadata({
      title: 'Bé & "mẹ" <script>',
      description: 'Mô tả "SEO" & bé.',
      canonical: 'https://vongdautam.vn/kien-thuc/bai?utm_source=zalo',
      type: 'article',
      image: { url: 'https://vongdautam.vn/media/2026/10/a.webp', alt: 'Ảnh bé', width: 1200, height: 630, mimeType: 'image/webp' },
    });
    expect(share.title).toBe('Bé & "mẹ" <script>');
    expect(share.description).toBe('Mô tả "SEO" & bé.');
    expect(share.url).toBe('https://vongdautam.vn/kien-thuc/bai?utm_source=zalo');
    expect(share.image).toMatchObject({ url: 'https://vongdautam.vn/media/2026/10/a.webp', alt: 'Ảnh bé', width: 1200, height: 630, mimeType: 'image/webp' });
    expect(share.card).toBe('summary_large_image');
    expect(shareMetadata({ title: 'Không ảnh', description: 'Mô tả', canonical: 'https://vongdautam.vn/kien-thuc/bai' }).card).toBe('summary');
    expect(shareMetadata({ title: 'Ảnh lạ', description: 'Mô tả', image: { url: 'https://evil.example/a.jpg', mimeType: 'image/jpeg' } }).image).toBeNull();
    expect(shareMetadata({ title: 'Svg', description: 'Mô tả', image: { url: 'https://vongdautam.vn/media/a.svg', mimeType: 'image/svg+xml' } }).image).toBeNull();
    expect(shareMetadata({ title: 'Thiếu cạnh', description: 'Mô tả', image: { url: 'https://vongdautam.vn/media/a.webp', width: 800 } }).image).toMatchObject({ width: null, height: null });
  });
});
