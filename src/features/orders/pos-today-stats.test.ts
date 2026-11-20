import { describe, expect, it } from 'vitest';
import { vnTodayStartMs } from '../../lib/datetime';

describe('pos-today-stats window', () => {
  it('mốc hôm nay là 00:00+07 và nằm trong ngày VN', () => {
    const now = Date.parse('2026-11-20T15:30:00+07:00');
    const start = vnTodayStartMs(now);
    expect(start).toBe(Date.parse('2026-11-20T00:00:00+07:00'));
    expect(start).toBeLessThanOrEqual(now);
    expect(now - start).toBeLessThan(24 * 60 * 60 * 1000);
  });
});
