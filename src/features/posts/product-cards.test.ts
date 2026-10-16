import { describe, expect, it } from 'vitest';
import {
  collectProductCardIds,
  normalizeProductCardCovers,
  normalizeProductCardIds,
  renderProductCardsHtml,
} from './product-cards';

describe('productCards', () => {
  it('chuẩn hóa id và gom từ JSON', () => {
    expect(normalizeProductCardIds([1, 1, 2, 0, '3'])).toEqual([1, 2, 3]);
    expect(
      collectProductCardIds({
        type: 'doc',
        content: [
          { type: 'productCards', attrs: { ids: [4, 5] } },
          { type: 'productCards', attrs: { ids: [5, 6] } },
        ],
      }),
    ).toEqual([4, 5, 6]);
  });

  it('chuẩn hóa covers chỉ giữ /media an toàn', () => {
    expect(normalizeProductCardCovers(['/media/a.jpg', 'https://x', '/media/../x', null], 3)).toEqual([
      '/media/a.jpg',
      '',
      '',
    ]);
  });

  it('render HTML có tên giá và CTA', () => {
    const html = renderProductCardsHtml([
      {
        id: 1,
        name: 'Vòng chỉ đỏ',
        slug: 'vong-chi-do',
        price: 89000,
        coverUrl: null,
        coverAlt: '',
        coverWidth: null,
        coverHeight: null,
      },
    ]);
    expect(html).toContain('Vòng chỉ đỏ');
    expect(html).toContain('/dat-hang?san-pham=vong-chi-do');
    expect(html).toContain('product-cards-price');
    expect(html).toContain('Đề xuất cho bé');
    expect(html).not.toContain('Xem mẫu');
    expect(html).not.toContain('/san-pham/');
    expect(html).toContain('product-cards');
  });
});
