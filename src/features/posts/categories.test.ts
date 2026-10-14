import { describe, expect, it } from 'vitest';
import { categoryDeleteWarning, categoryPageMeta, categoryRedirect } from './categories';

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

  it('SEO trống thì dùng tên và mô tả danh mục', () => {
    expect(
      categoryPageMeta(
        { name: 'Cách chọn vòng', description: 'Nhìn chất tơ.', seoTitle: '', metaDescription: '  ' },
        'Vòng dâu',
        'Mặc định',
      ),
    ).toEqual({ title: 'Cách chọn vòng | Vòng dâu', description: 'Nhìn chất tơ.' });
    expect(
      categoryPageMeta(
        { name: 'Cách chọn vòng', description: null, seoTitle: 'Chọn vòng cho bé', metaDescription: 'Mô tả tìm kiếm.' },
        'Vòng dâu',
        'Mặc định',
      ),
    ).toEqual({ title: 'Chọn vòng cho bé | Vòng dâu', description: 'Mô tả tìm kiếm.' });
  });
});
