import { describe, expect, it } from 'vitest';
import { clampMediaPage, parseMediaLibraryQuery } from './library';

describe('truy vấn thư viện ảnh', () => {
  it('giữ bộ lọc hợp lệ và bỏ giá trị lạ', () => {
    const query = parseMediaLibraryQuery(new URLSearchParams('q=  vòng  &usage=used&sort=size&page=2'));
    expect(query).toEqual({ q: 'vòng', usage: 'used', sort: 'size', page: 2 });
    expect(parseMediaLibraryQuery(new URLSearchParams('usage=nope&sort=nope&page=0'))).toEqual({
      q: '',
      usage: 'all',
      sort: 'newest',
      page: 1,
    });
  });

  it('kẹp trang theo tổng số ảnh', () => {
    expect(clampMediaPage(9, 30, 24)).toBe(2);
    expect(clampMediaPage(1, 0, 24)).toBe(1);
  });
});