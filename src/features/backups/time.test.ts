import { describe, expect, it } from 'vitest';
import {
  formatVnDateTime,
  utcHourToVnHour,
  vnDateTimeToUtcMs,
  vnDayKey,
  vnHourToUtcHour,
  vnYearMonth,
} from './time';

describe('backup time VN', () => {
  it('đổi giờ VN ↔ UTC', () => {
    expect(vnHourToUtcHour(0)).toBe(17);
    expect(utcHourToVnHour(17)).toBe(0);
    expect(vnHourToUtcHour(22)).toBe(15);
    expect(utcHourToVnHour(15)).toBe(22);
  });

  it('parse ngày giờ VN sang UTC', () => {
    const ms = vnDateTimeToUtcMs('2026-11-22', 22, 0);
    expect(ms).toBe(Date.UTC(2026, 10, 22, 15, 0, 0, 0));
    expect(vnDateTimeToUtcMs('22/11/2026', 22, 0)).toBeNull();
  });

  it('vnDayKey theo UTC+7', () => {
    // 2026-11-21 17:00 UTC = 2026-11-22 00:00 VN
    expect(vnDayKey(Date.UTC(2026, 10, 21, 17, 0, 0, 0))).toBe('2026-11-22');
  });

  it('formatVnDateTime và vnYearMonth theo giờ VN', () => {
    // 2026-11-27 17:00:35 UTC = 00:00:35 28/11/2026 VN
    const ms = Date.UTC(2026, 10, 27, 17, 0, 35);
    expect(formatVnDateTime(ms)).toBe('00:00 28/11/2026');
    expect(vnYearMonth(ms)).toEqual({ year: '2026', month: '11' });
  });
});
