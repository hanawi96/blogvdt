import { describe, expect, it } from 'vitest';
import { normalizePhoneBatch } from './phone-saved';

describe('normalizePhoneBatch', () => {
  it('chuẩn hóa, khử trùng và bỏ số không hợp lệ', () => {
    expect(normalizePhoneBatch(['0931 208 456', '0931208456', 'abc', '84931208456'])).toEqual([
      '0931208456',
    ]);
  });

  it('giới hạn 100 số', () => {
    const raw = Array.from({ length: 120 }, (_, i) => `093${String(1000000 + i).slice(-7)}`);
    expect(normalizePhoneBatch(raw)).toHaveLength(100);
  });
});
