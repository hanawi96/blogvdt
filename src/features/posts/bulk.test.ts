import { describe, expect, it } from 'vitest';
import { POST_BULK_ACTIONS, readPostBulk } from './posts';

function form(entries: Array<[string, string]>): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

describe('readPostBulk', () => {
  it('nhận action hợp lệ và gom id, loại bỏ trùng và giá trị không hợp lệ', () => {
    const parsed = readPostBulk(
      form([
        ['bulk', 'trash'],
        ['ids', '3'],
        ['ids', '3'],
        ['ids', '5'],
        ['ids', '0'],
        ['ids', '-2'],
        ['ids', 'x'],
      ]),
    );
    expect(parsed).toEqual({ action: 'trash', ids: [3, 5] });
  });

  it('từ chối khi thiếu action, action lạ hoặc không có id', () => {
    expect(readPostBulk(form([['ids', '1']]))).toBeNull();
    expect(readPostBulk(form([['bulk', 'archive'], ['ids', '1']]))).toBeNull();
    expect(readPostBulk(form([['bulk', 'trash']]))).toBeNull();
  });

  it('chặn lựa chọn vượt quá một trang (20)', () => {
    const many: Array<[string, string]> = [['bulk', 'publish']];
    for (let id = 1; id <= 21; id += 1) many.push(['ids', String(id)]);
    expect(readPostBulk(form(many))).toBeNull();

    const exactly: Array<[string, string]> = [['bulk', 'publish']];
    for (let id = 1; id <= 20; id += 1) exactly.push(['ids', String(id)]);
    expect(readPostBulk(form(exactly))?.ids).toHaveLength(20);
  });

  it('bộ action cố định đúng bốn thao tác', () => {
    expect([...POST_BULK_ACTIONS]).toEqual(['publish', 'trash', 'restore', 'purge']);
  });
});
