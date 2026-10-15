import { describe, expect, it } from 'vitest';
import { ORDER_MAX_QUANTITY } from '../orders/order';
import { CART_MAX_LINES, CART_MAX_QUANTITY, addCartLine, cartSummary, parseCart, postedCartLines, serializeCart } from './cart';

describe('giỏ hàng', () => {
  it('gộp cùng mẫu và cùng lựa chọn, chặn giỏ quá dài', () => {
    expect(CART_MAX_QUANTITY).toBe(ORDER_MAX_QUANTITY);
    const first = addCartLine([], { slug: 'vong-to-tam-tron', option: 'Size vừa', quantity: 2 });
    const second = first.ok ? addCartLine(first.lines, { slug: 'vong-to-tam-tron', option: 'Size vừa', quantity: 3 }) : first;
    expect(second.ok && second.lines).toEqual([{ slug: 'vong-to-tam-tron', option: 'Size vừa', quantity: 5 }]);
    let lines = second.ok ? second.lines : [];
    for (let index = 0; index < CART_MAX_LINES; index += 1) {
      const added = addCartLine(lines, { slug: `mau-${index}`, option: '', quantity: 1 });
      if (added.ok) lines = added.lines;
    }
    const overflow = addCartLine(lines, { slug: 'mau-them', option: '', quantity: 1 });
    expect(overflow.ok).toBe(false);
  });

  it('bỏ cookie hỏng và giữ cookie hợp lệ', () => {
    expect(parseCart('không phải json')).toEqual([]);
    const raw = serializeCart([{ slug: 'vong-chi-do', quantity: 1, option: '' }]);
    expect(parseCart(raw)).toEqual([{ slug: 'vong-chi-do', quantity: 1, option: '' }]);
    expect(postedCartLines(['vong-chi-do', 'vong-chi-do'], ['1', '2'], ['', ''])).toEqual({
      ok: true,
      lines: [{ slug: 'vong-chi-do', quantity: 3, option: '' }],
    });
  });

  it('tóm tắt tên cho danh sách đơn', () => {
    expect(cartSummary(['Vòng A', 'Vòng B'])).toBe('Vòng A, Vòng B');
    expect(cartSummary(['Vòng A', 'Vòng B', 'Vòng C'])).toBe('Vòng A + 2 mẫu');
  });
});
