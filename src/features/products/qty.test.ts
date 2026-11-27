import { describe, expect, it } from 'vitest';
import { isValidQty, needsQtyPicker, qtyBounds, qtyHint, qtyRequiredMessage, QTY_HARD_MAX } from './qty';

describe('số lượng theo danh mục', () => {
  it('mặc định 1–20 và chuẩn hóa min/max lệch', () => {
    expect(qtyBounds(null)).toEqual({ min: 1, max: 20 });
    expect(qtyBounds({ qtyMin: 500, qtyMax: 10 })).toEqual({ min: 10, max: 500 });
    expect(qtyBounds({ qtyMin: 0, qtyMax: 999 }).max).toBe(QTY_HARD_MAX);
  });

  it('hạt cần chọn SL khi min > 1', () => {
    const beads = qtyBounds({ qtyMin: 10, qtyMax: 500 });
    expect(needsQtyPicker(beads)).toBe(true);
    expect(qtyHint(beads)).toBe('Tối thiểu 10 hạt, tối đa 500 hạt');
    expect(isValidQty(beads, 9)).toBe(false);
    expect(isValidQty(beads, 10)).toBe(true);
    expect(isValidQty(beads, 500)).toBe(true);
    expect(isValidQty(beads, 501)).toBe(false);
    expect(qtyRequiredMessage(beads)).toBe('Số lượng từ 10 đến 500.');
  });

  it('vòng thường không bắt modal số lượng', () => {
    const normal = qtyBounds({ qtyMin: 1, qtyMax: 20 });
    expect(needsQtyPicker(normal)).toBe(false);
    expect(qtyHint(normal)).toBeNull();
  });
});
