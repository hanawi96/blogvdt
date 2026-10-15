import { describe, expect, it } from 'vitest';
import { parseListPage } from './public';
import { copyTitle, statusTotals } from './posts';

describe('danh sách bài viết', () => {
  it('đếm tất cả, nháp và bài đã xuất bản', () => {
    expect(statusTotals([
      { status: 'published', trashed: 0, value: 3 },
      { status: 'draft', trashed: 0, value: 1 },
      { status: 'published', trashed: 1, value: 2 },
    ])).toEqual({
      all: 4,
      draft: 1,
      published: 3,
      trash: 2,
    });
  });

  it('chỉ nhận số trang nguyên dương, còn lại là không tồn tại', () => {
    expect(parseListPage(null)).toBe(1);
    expect(parseListPage('2')).toBe(2);
    expect(parseListPage('0')).toBeNull();
    expect(parseListPage('abc')).toBeNull();
    expect(parseListPage('01')).toBeNull();
    expect(parseListPage('1000000')).toBeNull();
  });

  it('thêm hậu tố bản sao mà không vượt 180 ký tự', () => {
    expect(copyTitle('Nên hỏi gì')).toBe('Nên hỏi gì (bản sao)');
    expect(copyTitle('a'.repeat(180)).length).toBe(180);
  });
});
