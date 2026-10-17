import { describe, expect, it } from 'vitest';
import {
  LANDING_MAX_BENEFITS,
  LANDING_MAX_BLOCKS,
  LANDING_MAX_PRODUCTS,
  hasProductsBlock,
  parseBlocks,
  referencedMediaIds,
  referencedProductIds,
  serializeBlocks,
  type LandingBlock,
} from './blocks';

describe('parseBlocks', () => {
  it('bỏ qua JSON hỏng và giá trị không phải mảng', () => {
    expect(parseBlocks('{bad json')).toEqual([]);
    expect(parseBlocks('{}')).toEqual([]);
    expect(parseBlocks(null)).toEqual([]);
    expect(parseBlocks(42)).toEqual([]);
  });

  it('giữ hero hợp lệ, chuẩn hoá anchor và mediaId', () => {
    const blocks = parseBlocks([
      { type: 'hero', title: '  Vòng dâu tằm  ', subtitle: 'Thủ công', imageMediaId: '5', ctaText: 'Mua ngay', ctaAnchor: '#san-pham' },
    ]);
    expect(blocks).toEqual([
      { type: 'hero', eyebrow: '', title: 'Vòng dâu tằm', subtitle: 'Thủ công', imageMediaId: 5, ctaText: 'Mua ngay', ctaAnchor: '#san-pham' },
    ]);
  });

  it('hero thiếu tiêu đề bị loại; anchor lạ về mặc định; mediaId xấu thành null', () => {
    const blocks = parseBlocks([
      { type: 'hero', title: '' },
      { type: 'hero', title: 'Có tiêu đề', ctaAnchor: 'https://evil', imageMediaId: -3 },
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ ctaAnchor: '#dat-hang', imageMediaId: null });
  });

  it('text rỗng hoàn toàn bị loại, giữ nếu có tiêu đề hoặc nội dung', () => {
    expect(parseBlocks([{ type: 'text', title: '', body: '' }])).toEqual([]);
    expect(parseBlocks([{ type: 'text', title: 'Giới thiệu', body: '' }])).toHaveLength(1);
  });

  it('image cần có ảnh hợp lệ; thiếu ảnh thì loại, chú thích được cắt và giữ', () => {
    expect(parseBlocks([{ type: 'image', imageMediaId: 0, caption: 'x' }])).toEqual([]);
    expect(parseBlocks([{ type: 'image', imageMediaId: '7', caption: '  Vòng dâu tằm  ' }])).toEqual([
      { type: 'image', imageMediaId: 7, caption: 'Vòng dâu tằm' },
    ]);
  });

  it('benefits bỏ mục rỗng, giới hạn số mục, loại khối khi không còn mục', () => {
    const many = Array.from({ length: LANDING_MAX_BENEFITS + 5 }, (_, i) => ({ title: `Lợi ích ${i}`, desc: 'mô tả' }));
    const blocks = parseBlocks([
      { type: 'benefits', title: 'Vì sao chọn', items: [{ title: '', desc: '' }, ...many] },
      { type: 'benefits', title: 'Trống', items: [{ title: '', desc: '' }] },
    ]);
    expect(blocks).toHaveLength(1);
    const first = blocks[0] as Extract<LandingBlock, { type: 'benefits' }>;
    expect(first.items).toHaveLength(LANDING_MAX_BENEFITS);
  });

  it('products dedupe id, bỏ id xấu, giới hạn số lượng; khối products luôn giữ kể cả rỗng', () => {
    const blocks = parseBlocks([{ type: 'products', title: 'Mẫu', productIds: [3, 3, 0, -1, 'x', 7] }]);
    expect(blocks).toEqual([{ type: 'products', title: 'Mẫu', productIds: [3, 7] }]);
    const over = parseBlocks([{ type: 'products', productIds: Array.from({ length: LANDING_MAX_PRODUCTS + 10 }, (_, i) => i + 1) }]);
    const block = over[0] as Extract<LandingBlock, { type: 'products' }>;
    expect(block.productIds).toHaveLength(LANDING_MAX_PRODUCTS);
  });

  it('cta có nút mặc định khi thiếu, anchor chuẩn hoá', () => {
    const blocks = parseBlocks([{ type: 'cta', title: 'Đặt ngay', anchor: '#san-pham' }]);
    expect(blocks[0]).toEqual({ type: 'cta', title: 'Đặt ngay', subtitle: '', buttonText: 'Đặt hàng ngay', anchor: '#san-pham' });
  });

  it('bỏ khối type lạ và giới hạn tổng số khối', () => {
    const mixed = [{ type: 'unknown' }, ...Array.from({ length: LANDING_MAX_BLOCKS + 5 }, () => ({ type: 'text', title: 'x' }))];
    expect(parseBlocks(mixed)).toHaveLength(LANDING_MAX_BLOCKS);
  });

  it('referencedProductIds và hasProductsBlock phản ánh đúng các khối', () => {
    const blocks = parseBlocks([
      { type: 'products', productIds: [1, 2] },
      { type: 'products', productIds: [2, 9] },
      { type: 'text', title: 'a' },
    ]);
    expect(referencedProductIds(blocks).sort()).toEqual([1, 2, 9]);
    expect(hasProductsBlock(blocks)).toBe(true);
    expect(hasProductsBlock(parseBlocks([{ type: 'text', title: 'a' }]))).toBe(false);
  });

  it('referencedMediaIds gom ảnh từ hero và image', () => {
    const blocks = parseBlocks([
      { type: 'hero', title: 'A', imageMediaId: 4 },
      { type: 'image', imageMediaId: 7 },
      { type: 'image', imageMediaId: 4 },
      { type: 'text', title: 'b' },
    ]);
    expect(referencedMediaIds(blocks).sort((a, b) => a - b)).toEqual([4, 7]);
  });

  it('serializeBlocks rồi parseBlocks cho kết quả ổn định', () => {
    const blocks = parseBlocks([{ type: 'hero', title: 'A' }, { type: 'cta', title: 'B' }]);
    expect(parseBlocks(serializeBlocks(blocks))).toEqual(blocks);
  });
});
