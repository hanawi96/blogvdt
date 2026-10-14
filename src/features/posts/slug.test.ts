import { describe, expect, it } from 'vitest';
import { slugify } from './slug';

describe('slugify', () => {
  it('bỏ dấu tiếng Việt và đổi khoảng trắng thành gạch', () => {
    expect(slugify('Vòng Dâu Tằm')).toBe('vong-dau-tam');
    expect(slugify('  Xin   chào, bé!  ')).toBe('xin-chao-be');
  });
});
