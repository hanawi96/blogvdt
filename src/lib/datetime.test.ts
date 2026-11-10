import { describe, expect, it } from 'vitest';
import {
  daysInMonth,
  formatOrderDateFilterLabel,
  formatTimeHm,
  vnLastNDaysRange,
  vnMonthRange,
  vnTodayParts,
  vnTodayStartMs,
  vnYesterdayRange,
} from './datetime';

describe('formatTimeHm', () => {
  it('trả HH:mm theo Asia/Ho_Chi_Minh', () => {
    // 2024-01-15 07:02:00 UTC = 14:02 VN
    expect(formatTimeHm(Date.UTC(2024, 0, 15, 7, 2, 0))).toBe('14:02');
  });
});

describe('vn calendar helpers', () => {
  // 2026-11-09 10:00 VN = 2026-11-09 03:00 UTC
  const now = Date.parse('2026-11-09T03:00:00.000Z');

  it('vnTodayParts theo Asia/Ho_Chi_Minh', () => {
    expect(vnTodayParts(now)).toEqual({ year: 2026, month: 11, day: 9 });
    // Gần nửa đêm UTC vẫn là ngày VN đúng
    expect(vnTodayParts(Date.parse('2026-11-08T17:30:00.000Z'))).toEqual({ year: 2026, month: 11, day: 9 });
  });

  it('vnTodayStartMs là 00:00 giờ VN', () => {
    expect(vnTodayStartMs(now)).toBe(Date.parse('2026-11-09T00:00:00+07:00'));
  });

  it('daysInMonth và vnMonthRange cắt đúng tháng hiện tại', () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(vnMonthRange(2026, 1, now)).toEqual({ from: '2026-01-01', to: '2026-01-31' });
    expect(vnMonthRange(2026, 11, now)).toEqual({ from: '2026-11-01', to: '2026-11-09' });
    expect(vnMonthRange(2026, 12, now)).toBeNull();
  });

  it('vnYesterdayRange và vnLastNDaysRange', () => {
    expect(vnYesterdayRange(now)).toEqual({ from: '2026-11-08', to: '2026-11-08' });
    expect(vnLastNDaysRange(7, now)).toEqual({ from: '2026-11-03', to: '2026-11-09' });
    expect(vnLastNDaysRange(30, now)).toEqual({ from: '2026-10-11', to: '2026-11-09' });
    expect(vnLastNDaysRange(0, now)).toBeNull();
  });

  it('formatOrderDateFilterLabel', () => {
    expect(formatOrderDateFilterLabel('', '', now)).toBe('Chọn ngày');
    expect(formatOrderDateFilterLabel('2026-11-08', '2026-11-08', now)).toBe('Hôm qua');
    expect(formatOrderDateFilterLabel('2026-11-03', '2026-11-09', now)).toBe('7 ngày qua');
    expect(formatOrderDateFilterLabel('2026-10-11', '2026-11-09', now)).toBe('30 ngày qua');
    expect(formatOrderDateFilterLabel('2026-11-15', '2026-11-15', now)).toBe('15/11');
    expect(formatOrderDateFilterLabel('2026-11-01', '2026-11-15', now)).toBe('01–15/11');
    expect(formatOrderDateFilterLabel('2026-11-01', '2026-11-09', now)).toBe('Tháng 11');
    expect(formatOrderDateFilterLabel('2026-01-01', '2026-01-31', now)).toBe('Tháng 1');
  });
});
