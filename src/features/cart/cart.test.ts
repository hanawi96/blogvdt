import { describe, expect, it } from 'vitest';
import { ORDER_MAX_QUANTITY } from '../orders/order';
import { CART_MAX_LINES, CART_MAX_QUANTITY, addCartLine, cartSummary, parseCart, postedCartLines, serializeCart } from './cart';

describe('giỏ hàng', () => {
  it('gộp cùng mẫu và cùng cân nặng, chặn giỏ quá dài', () => {
    expect(CART_MAX_QUANTITY).toBe(ORDER_MAX_QUANTITY);
    const first = addCartLine([], { slug: 'vong-to-tam-tron', weight: '5kg', quantity: 2 });
    const second = first.ok ? addCartLine(first.lines, { slug: 'vong-to-tam-tron', weight: '5kg', quantity: 3 }) : first;
    expect(second.ok && second.lines).toEqual([{ slug: 'vong-to-tam-tron', weight: '5kg', quantity: 5, note: '' }]);
    let lines = second.ok ? second.lines : [];
    for (let index = 0; index < CART_MAX_LINES; index += 1) {
      const added = addCartLine(lines, { slug: `mau-${index}`, weight: '', quantity: 1 });
      if (added.ok) lines = added.lines;
    }
    const overflow = addCartLine(lines, { slug: 'mau-them', weight: '', quantity: 1 });
    expect(overflow.ok).toBe(false);
  });

  it('tách dòng riêng khi cùng mẫu khác cân nặng hoặc khác tên in thẻ', () => {
    const first = addCartLine([], { slug: 'vong-chi-do', weight: '5kg', quantity: 1 });
    const second = first.ok ? addCartLine(first.lines, { slug: 'vong-chi-do', weight: '6kg', quantity: 1 }) : first;
    expect(second.ok && second.lines).toEqual([
      { slug: 'vong-chi-do', weight: '5kg', quantity: 1, note: '' },
      { slug: 'vong-chi-do', weight: '6kg', quantity: 1, note: '' },
    ]);
    const tagged = addCartLine([], { slug: 'the-ten', weight: '5kg', quantity: 1, note: 'Minh An' });
    const other = tagged.ok ? addCartLine(tagged.lines, { slug: 'the-ten', weight: '5kg', quantity: 1, note: 'Bé Na' }) : tagged;
    expect(other.ok && other.lines).toEqual([
      { slug: 'the-ten', weight: '5kg', quantity: 1, note: 'Minh An' },
      { slug: 'the-ten', weight: '5kg', quantity: 1, note: 'Bé Na' },
    ]);
  });

  it('bỏ cookie hỏng và giữ cookie hợp lệ', () => {
    expect(parseCart('không phải json')).toEqual([]);
    const raw = serializeCart([{ slug: 'vong-chi-do', quantity: 1, weight: 'Chưa sinh', note: '' }]);
    expect(parseCart(raw)).toEqual([{ slug: 'vong-chi-do', quantity: 1, weight: 'Chưa sinh', note: '' }]);
    expect(parseCart(serializeCart([{ slug: 'the-ten', quantity: 1, weight: '5kg', note: 'Minh An' }]))).toEqual([
      { slug: 'the-ten', quantity: 1, weight: '5kg', note: 'Minh An' },
    ]);
    expect(postedCartLines(['vong-chi-do', 'vong-chi-do'], ['1', '2'], ['5kg', '5kg'])).toEqual({
      ok: true,
      lines: [{ slug: 'vong-chi-do', quantity: 3, weight: '5kg', note: '' }],
    });
  });

  it('tóm tắt tên cho danh sách đơn', () => {
    expect(cartSummary(['Vòng A', 'Vòng B'])).toBe('Vòng A, Vòng B');
    expect(cartSummary(['Vòng A', 'Vòng B', 'Vòng C'])).toBe('Vòng A + 2 mẫu');
  });
});
