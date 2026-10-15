import { describe, expect, it } from 'vitest';
import { visibleComparePrice } from './catalog';

describe('giá gốc trên trang mẫu vòng', () => {
  it('chỉ hiện giá gốc khi lớn hơn giá bán', () => {
    expect(visibleComparePrice(150000, 180000)).toBe(180000);
    expect(visibleComparePrice(150000, 150000)).toBeNull();
    expect(visibleComparePrice(150000, null)).toBeNull();
  });
});
