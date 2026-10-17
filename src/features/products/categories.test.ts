import { describe, expect, it } from 'vitest';
import { categoryListQuery, categoryMovePlan, productCategoryDeleteWarning, productCategoryInUseError, readProductCategory } from './categories';

describe('danh mục sản phẩm', () => {
  it('chuẩn hóa tên và slug, giữ mô tả đã cắt khoảng trắng', () => {
    const parsed = readProductCategory({ name: '  Vòng charm  ', slug: '', description: '  Charm bạc  ', coverMediaId: ' 4 ', weightScale: 'baby' });
    expect(parsed.ok && parsed.value).toEqual({ name: 'Vòng charm', slug: 'vong-charm', description: 'Charm bạc', coverMediaId: 4, weightScale: 'baby' });
  });

  it('cho phép danh mục không ảnh và từ chối id ảnh sai', () => {
    const empty = readProductCategory({ name: 'Vòng charm', slug: 'vong-charm', description: '', coverMediaId: '', weightScale: 'none' });
    expect(empty.ok && empty.value.coverMediaId).toBeNull();
    const bad = readProductCategory({ name: 'Vòng charm', slug: 'vong-charm', description: '', coverMediaId: 'anh', weightScale: 'baby' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toBe('Ảnh danh mục không hợp lệ.');
  });

  it('từ chối tên trống, slug không tạo được và thang cân nặng lạ', () => {
    expect(readProductCategory({ name: '  ', slug: '', description: '', coverMediaId: '', weightScale: 'baby' }).ok).toBe(false);
    const symbols = readProductCategory({ name: '!!!', slug: '', description: '', coverMediaId: '', weightScale: 'baby' });
    expect(symbols.ok).toBe(false);
    if (!symbols.ok) expect(symbols.error).toBe('Slug không hợp lệ.');
    const badScale = readProductCategory({ name: 'Vòng charm', slug: 'vong-charm', description: '', coverMediaId: '', weightScale: 'teen' });
    expect(badScale.ok).toBe(false);
    if (!badScale.ok) expect(badScale.error).toBe('Thang cân nặng không hợp lệ.');
  });

  it('chỉ xóa danh mục không còn sản phẩm', () => {
    expect(productCategoryInUseError(0)).toBeNull();
    expect(productCategoryInUseError(2)).toBe('Danh mục đang có sản phẩm, chưa xóa được.');
    expect(productCategoryDeleteWarning()).toBe('Xóa danh mục này?');
  });

  it('đổi chỗ hai danh mục và đánh số lại thứ tự', () => {
    const rows = [
      { id: 1, sortOrder: 0 },
      { id: 2, sortOrder: 0 },
      { id: 3, sortOrder: 5 },
    ];
    expect(categoryMovePlan(rows, 2, 'up')).toEqual([
      { id: 1, sortOrder: 1 },
      { id: 3, sortOrder: 2 },
    ]);
    expect(categoryMovePlan(rows, 1, 'up')).toEqual([]);
    expect(categoryMovePlan(rows, 3, 'down')).toEqual([]);
    expect(categoryListQuery('  vòng_% ')).toBe('vòng');
  });
});
