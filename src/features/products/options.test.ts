import { describe, expect, it } from 'vitest';
import { parseOptionsText, readOptions } from './options';

describe('lựa chọn sản phẩm', () => {
  it('đọc JSON và bỏ dòng trống', () => {
    expect(readOptions('["Size nhỏ","  ","Size vừa"]')).toEqual(['Size nhỏ', 'Size vừa']);
    expect(readOptions('không phải json')).toEqual([]);
  });

  it('từ chối lựa chọn trùng hoặc quá nhiều', () => {
    expect(parseOptionsText('Size nhỏ\nSize vừa').ok).toBe(true);
    expect(parseOptionsText('Size nhỏ\nSize nhỏ')).toEqual({ ok: false, error: 'Các lựa chọn không được trùng.' });
    expect(parseOptionsText(Array.from({ length: 13 }, (_, index) => `Size ${index}`).join('\n')).ok).toBe(false);
  });
});
