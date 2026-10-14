import { describe, expect, it } from 'vitest';
import { articleSchema, buildMeta, jsonLd, productSchema } from './meta';

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

  it('schema bài viết không thêm đánh giá', () => {
    const schema = articleSchema({
      headline: 'Bài',
      description: 'Mô tả',
      canonical: 'http://localhost:4321/kien-thuc/bai',
      image: null,
      publishedTime: '2026-10-01T00:00:00.000Z',
      siteName: 'Vòng Dâu Tằm',
    });
    expect(schema['@type']).toBe('Article');
    expect(schema).not.toHaveProperty('aggregateRating');
    expect(jsonLd(schema)).not.toContain('<');
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
