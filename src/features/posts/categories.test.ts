import { describe, expect, it } from 'vitest';
import { categoryDeleteWarning, categoryRedirect } from './categories';

describe('danh mục', () => {
  it('chỉ tạo redirect khi slug đổi', () => {
    expect(categoryRedirect('cach-chon-vong', 'cach-chon-vong')).toBeNull();
    expect(categoryRedirect('cach-chon-vong', 'chon-vong')).toEqual({
      from: '/kien-thuc/danh-muc/cach-chon-vong',
      to: '/kien-thuc/danh-muc/chon-vong',
    });
  });

  it('cảnh báo số bài trước khi xóa và không nói là xóa bài', () => {
    expect(categoryDeleteWarning(0)).toBe('Xóa danh mục này?');
    expect(categoryDeleteWarning(2)).toContain('2 bài viết');
    expect(categoryDeleteWarning(2)).toContain('giữ lại');
  });

});
