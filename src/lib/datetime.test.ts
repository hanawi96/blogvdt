import { describe, expect, it } from 'vitest';
import { formatTimeHm } from './datetime';

describe('formatTimeHm', () => {
  it('trả HH:mm theo Asia/Ho_Chi_Minh', () => {
    // 2024-01-15 07:02:00 UTC = 14:02 VN
    expect(formatTimeHm(Date.UTC(2024, 0, 15, 7, 2, 0))).toBe('14:02');
  });
});
