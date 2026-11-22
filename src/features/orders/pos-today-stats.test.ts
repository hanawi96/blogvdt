import { describe, expect, it } from 'vitest';
import { calendarRange, vnLastNDaysRange, vnTodayRange, vnYesterdayRange } from '../../lib/datetime';
import {
  averagePerOrder,
  defaultTodayStatsWindow,
  resolveOrderSummaryWindow,
} from './pos-today-stats';

describe('order summary window', () => {
  const now = Date.parse('2026-11-20T15:30:00+07:00');

  it('defaultTodayStatsWindow = [00:00 hôm nay, 00:00 ngày mai) VN', () => {
    const today = vnTodayRange(now);
    const expected = calendarRange(today.from, today.to);
    expect(defaultTodayStatsWindow(now)).toEqual({
      start: expected.start,
      end: expected.end,
    });
    expect(defaultTodayStatsWindow(now).start).toBe(Date.parse('2026-11-20T00:00:00+07:00'));
    expect(defaultTodayStatsWindow(now).end).toBe(Date.parse('2026-11-21T00:00:00+07:00'));
  });

  it('không chọn ngày → hôm nay, trùng nút «Hôm nay»', () => {
    const resolved = resolveOrderSummaryWindow('', '', now);
    const today = vnTodayRange(now);
    const todayWindow = calendarRange(today.from, today.to);
    expect(resolved).toEqual({
      ok: true,
      usesDateFilter: false,
      window: { start: todayWindow.start, end: todayWindow.end },
    });
    expect(resolveOrderSummaryWindow(today.from, today.to, now)).toEqual({
      ok: true,
      usesDateFilter: true,
      window: { start: todayWindow.start, end: todayWindow.end },
    });
  });

  it('Hôm qua / 7 / 60 / 90 ngày khớp calendarRange bộ lọc', () => {
    const yesterday = vnYesterdayRange(now);
    const yWin = calendarRange(yesterday.from, yesterday.to);
    expect(resolveOrderSummaryWindow(yesterday.from, yesterday.to, now)).toEqual({
      ok: true,
      usesDateFilter: true,
      window: { start: yWin.start, end: yWin.end },
    });

    for (const days of [7, 30, 60, 90] as const) {
      const span = vnLastNDaysRange(days, now)!;
      const win = calendarRange(span.from, span.to);
      expect(resolveOrderSummaryWindow(span.from, span.to, now)).toEqual({
        ok: true,
        usesDateFilter: true,
        window: { start: win.start, end: win.end },
      });
    }
  });

  it('chỉ from hoặc chỉ to vẫn mở đúng nửa khoảng', () => {
    expect(resolveOrderSummaryWindow('2026-11-01', '', now)).toEqual({
      ok: true,
      usesDateFilter: true,
      window: { start: Date.parse('2026-11-01T00:00:00+07:00'), end: null },
    });
    expect(resolveOrderSummaryWindow('', '2026-11-01', now)).toEqual({
      ok: true,
      usesDateFilter: true,
      window: { start: null, end: Date.parse('2026-11-02T00:00:00+07:00') },
    });
  });

  it('khoảng invalid → không dùng cửa sổ (tránh cộng cả lịch sử)', () => {
    expect(resolveOrderSummaryWindow('2026-11-20', '2026-11-19', now)).toEqual({
      ok: false,
      reason: 'invalid_range',
    });
    expect(resolveOrderSummaryWindow('bad', '2026-11-20', now)).toEqual({
      ok: false,
      reason: 'invalid_range',
    });
  });

  it('averagePerOrder làm tròn VND, mẫu số 0 → 0', () => {
    expect(averagePerOrder(100_000, 0)).toBe(0);
    expect(averagePerOrder(100_000, 3)).toBe(33333);
    expect(averagePerOrder(-50_000, 2)).toBe(-25000);
  });
});
