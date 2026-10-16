import { describe, expect, it } from 'vitest';
import { countWords, readingStats, readingStatsLabel } from './reading-stats';

describe('reading-stats', () => {
  it('đếm từ theo khoảng trắng, bỏ khoảng trắng thừa', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
    expect(countWords('vòng dâu tằm')).toBe(3);
    expect(countWords('  xin   chào \n các mẹ  ')).toBe(4);
  });

  it('phút đọc tối thiểu 1 khi có chữ, 0 khi rỗng', () => {
    expect(readingStats('')).toEqual({ words: 0, minutes: 0 });
    expect(readingStats('một từ').minutes).toBe(1);
    // 400 từ ÷ 200 = 2 phút.
    expect(readingStats(Array.from({ length: 400 }, () => 'a').join(' '))).toEqual({ words: 400, minutes: 2 });
  });

  it('nhãn hiển thị đúng định dạng', () => {
    expect(readingStatsLabel('')).toBe('0 từ');
    expect(readingStatsLabel('vòng dâu tằm')).toBe('3 từ · ~1 phút đọc');
  });
});
