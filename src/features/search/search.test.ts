import { describe, expect, it } from 'vitest';
import { normalizeSearchQuery, searchQueryReady } from './query';

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
