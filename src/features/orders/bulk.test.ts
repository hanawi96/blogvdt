import { describe, expect, it } from 'vitest';
import { ORDER_BULK_ACTIONS, ORDER_BULK_MAX, readOrderBulk } from './orders';

function form(entries: Array<[string, string]>): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

describe('readOrderBulk', () => {
  it('nhận action delete và gom id, loại bỏ trùng và giá trị không hợp lệ', () => {
    const parsed = readOrderBulk(
      form([
        ['bulk', 'delete'],
        ['ids', '3'],
        ['ids', '3'],
        ['ids', '5'],
        ['ids', '0'],
        ['ids', '-2'],
        ['ids', 'x'],
      ]),
    );
    expect(parsed).toEqual({ action: 'delete', ids: [3, 5] });
  });

  it('nhận action export hợp lệ và gom id', () => {
    expect(readOrderBulk(form([['bulk', 'export'], ['ids', '1']]))).toEqual({ action: 'export', ids: [1] });
  });

  it('từ chối khi thiếu action, action lạ hoặc không có id', () => {
    expect(readOrderBulk(form([['ids', '1']]))).toBeNull();
    expect(readOrderBulk(form([['bulk', 'xoa-het'], ['ids', '1']]))).toBeNull();
    expect(readOrderBulk(form([['bulk', 'delete']]))).toBeNull();
  });

  it(`chặn lựa chọn vượt quá một trang (${ORDER_BULK_MAX})`, () => {
    const many: Array<[string, string]> = [['bulk', 'delete']];
    for (let id = 1; id <= ORDER_BULK_MAX + 1; id += 1) many.push(['ids', String(id)]);
    expect(readOrderBulk(form(many))).toBeNull();

    const exactly: Array<[string, string]> = [['bulk', 'delete']];
    for (let id = 1; id <= ORDER_BULK_MAX; id += 1) exactly.push(['ids', String(id)]);
    expect(readOrderBulk(form(exactly))?.ids).toHaveLength(ORDER_BULK_MAX);
  });

  it('bộ action cố định gồm xóa và export', () => {
    expect([...ORDER_BULK_ACTIONS]).toEqual(['delete', 'export']);
  });
});
