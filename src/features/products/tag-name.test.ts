import { describe, expect, it } from 'vitest';
import { productRequiresTagName, readTagName, tagNameToLineNote } from './tag-name';

describe('tên in thẻ', () => {
  it('nhận diện SP có chữ thẻ (không phân biệt hoa thường)', () => {
    expect(productRequiresTagName('Mix bạc + Thẻ tên bé')).toBe(true);
    expect(productRequiresTagName('Trơn + thẻ rắn')).toBe(true);
    expect(productRequiresTagName('Vòng trơn cổ điển')).toBe(false);
  });

  it('chuẩn hóa và giới hạn độ dài tên in', () => {
    expect(readTagName('  Minh An  ')).toBe('Minh An');
    expect(readTagName('')).toBeNull();
    expect(readTagName('x'.repeat(41))).toBe('bad');
  });

  it('ghi note dòng SP luôn có chữ thẻ cho chip admin', () => {
    expect(tagNameToLineNote('Minh An')).toBe('thẻ: Minh An');
    expect(tagNameToLineNote('thẻ tròn Cá')).toBe('thẻ tròn Cá');
  });
});
