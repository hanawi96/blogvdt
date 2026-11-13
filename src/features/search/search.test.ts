import { describe, expect, it } from 'vitest';
import {
  normalizeSearchQuery,
  readSearchKind,
  readSearchPage,
  searchPath,
  searchQueryReady,
} from './query';
import { SEARCH_OVERVIEW_LIMIT, SEARCH_PAGE_SIZE } from './search';

describe('normalizeSearchQuery', () => {
  it('cắt khoảng trắng, bỏ wildcard LIKE, giới hạn độ dài', () => {
    expect(normalizeSearchQuery('  vòng  %dâu_  ')).toBe('vòng dâu');
    expect(normalizeSearchQuery('a'.repeat(100), 10)).toBe('a'.repeat(10));
    expect(normalizeSearchQuery(null)).toBe('');
  });

  it('chỉ sẵn sàng từ 2 ký tự', () => {
    expect(searchQueryReady('')).toBe(false);
    expect(searchQueryReady('a')).toBe(false);
    expect(searchQueryReady('ab')).toBe(true);
  });
});

describe('search query helpers', () => {
  it('đọc loại và trang an toàn', () => {
    expect(readSearchKind('san-pham')).toBe('san-pham');
    expect(readSearchKind('bai-viet')).toBe('bai-viet');
    expect(readSearchKind('khac')).toBeNull();
    expect(readSearchPage('3')).toBe(3);
    expect(readSearchPage('0')).toBe(1);
    expect(readSearchPage('x')).toBe(1);
  });

  it('ghép URL kết quả gọn', () => {
    expect(searchPath('vòng')).toBe('/tim-kiem?q=v%C3%B2ng');
    expect(searchPath('vòng', { kind: 'san-pham' })).toBe('/tim-kiem?q=v%C3%B2ng&loai=san-pham');
    expect(searchPath('vòng', { kind: 'bai-viet', page: 2 })).toBe('/tim-kiem?q=v%C3%B2ng&loai=bai-viet&page=2');
    expect(searchPath('vòng', { kind: 'san-pham', page: 1 })).toBe('/tim-kiem?q=v%C3%B2ng&loai=san-pham');
  });

  it('giữ giới hạn overview / trang xem thêm', () => {
    expect(SEARCH_OVERVIEW_LIMIT).toBe(6);
    expect(SEARCH_PAGE_SIZE).toBe(12);
  });
});
