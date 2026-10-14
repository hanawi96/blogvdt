import { describe, expect, it } from 'vitest';
import { copyTitle, statusTotals } from './posts';

describe('danh sách bài viết', () => {
  it('đếm tất cả, nháp và bài đã xuất bản', () => {
    expect(statusTotals([{ status: 'published', value: 3 }, { status: 'draft', value: 1 }])).toEqual({
      all: 4,
      draft: 1,
      published: 3,
    });
  });

  it('thêm hậu tố bản sao mà không vượt 180 ký tự', () => {
    expect(copyTitle('Nên hỏi gì')).toBe('Nên hỏi gì (bản sao)');
    expect(copyTitle('a'.repeat(180)).length).toBe(180);
  });
});
