import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  OVERVIEW_DAYS,
  averageValue,
  cancelRate,
  chartEmptyHint,
  chartLegend,
  dayWindows,
  kpiTitle,
  describeDelta,
  fillDailySeries,
  mergeLeastProducts,
  mergeTopProducts,
  overviewWindows,
  percentChange,
  periodRange,
  readChartRange,
  readPeriod,
  todayHourWindows,
} from './metrics';

describe('kỳ thống kê', () => {
  it('chỉ nhận 7, 30, 90 ngày và mặc định 7', () => {
    expect(readPeriod('7')).toBe(7);
    expect(readPeriod('90')).toBe(90);
    expect(readPeriod('15')).toBe(7);
    expect(readPeriod(null)).toBe(7);
    expect(readPeriod('abc')).toBe(7);
  });

  it('kỳ biểu đồ chỉ nhận today, 7, 30 và mặc định 7', () => {
    expect(readChartRange('today')).toBe('today');
    expect(readChartRange('7')).toBe('7');
    expect(readChartRange('30')).toBe('30');
    expect(readChartRange('90')).toBe('7');
    expect(readChartRange(null)).toBe('7');
  });

  it('kỳ trước liền kề và cùng độ dài kỳ hiện tại', () => {
    const now = 1_000 * DAY_MS;
    expect(periodRange(30, now)).toEqual({ start: now - 30 * DAY_MS, previousStart: now - 60 * DAY_MS });
  });

  it('cửa sổ overview 7 ngày lịch VN liền kề kỳ trước', () => {
    const now = Date.parse('2026-11-13T15:00:00+07:00');
    const win = overviewWindows(now);
    expect(OVERVIEW_DAYS).toBe(7);
    expect(win.currentDays).toEqual([
      '2026-11-07',
      '2026-11-08',
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
    ]);
    expect(win.previousDays).toEqual([
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
    ]);
    expect(win.currentStart).toBe(Date.parse('2026-11-07T00:00:00+07:00'));
    expect(win.previousStart).toBe(Date.parse('2026-10-31T00:00:00+07:00'));
  });

  it('cửa sổ 30 ngày lịch VN liền kề kỳ trước', () => {
    const now = Date.parse('2026-11-13T15:00:00+07:00');
    const win = dayWindows(30, now);
    expect(win.currentDays).toHaveLength(30);
    expect(win.previousDays).toHaveLength(30);
    expect(win.currentDays[0]).toBe('2026-10-15');
    expect(win.currentDays[29]).toBe('2026-11-13');
    expect(win.previousDays[0]).toBe('2026-09-15');
    expect(win.previousDays[29]).toBe('2026-10-14');
    expect(win.currentStart).toBe(Date.parse('2026-10-15T00:00:00+07:00'));
    expect(win.previousStart).toBe(Date.parse('2026-09-15T00:00:00+07:00'));
  });

  it('cửa sổ hôm nay theo giờ VN so với hôm qua', () => {
    const now = Date.parse('2026-11-13T15:00:00+07:00');
    const win = todayHourWindows(now);
    expect(win.currentDay).toBe('2026-11-13');
    expect(win.previousDay).toBe('2026-11-12');
    expect(win.hours).toHaveLength(24);
    expect(win.hours[0]).toBe('00');
    expect(win.hours[23]).toBe('23');
    expect(win.labels[0]).toBe('0h');
    expect(win.labels[15]).toBe('15h');
    expect(win.currentStart).toBe(Date.parse('2026-11-13T00:00:00+07:00'));
    expect(win.previousStart).toBe(Date.parse('2026-11-12T00:00:00+07:00'));
    expect(chartLegend('today')).toEqual({ current: 'Hôm nay', previous: 'Hôm qua' });
    expect(chartEmptyHint('today')).toBe('Chưa có đơn hôm nay.');
    expect(chartEmptyHint('7')).toContain('7 ngày');
    expect(chartEmptyHint('30')).toContain('30 ngày');
    expect(kpiTitle('today')).toBe('Chỉ số hôm nay');
    expect(kpiTitle('7')).toBe('Chỉ số 7 ngày gần nhất');
    expect(kpiTitle('30')).toBe('Chỉ số 30 ngày gần nhất');
  });

  it('điền 0 cho ngày thiếu trong series', () => {
    expect(fillDailySeries(['2026-11-01', '2026-11-02', '2026-11-03'], [{ day: '2026-11-02', value: 4 }])).toEqual([
      0, 4, 0,
    ]);
  });
});

describe('chỉ số', () => {
  it('tính % thay đổi, kể cả khi kỳ trước bằng 0', () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
    expect(percentChange(0, 0)).toBe(0);
    expect(percentChange(5, 0)).toBeNull();
  });

  it('trung bình và tỉ lệ hủy không chia cho 0', () => {
    expect(averageValue(300000, 2)).toBe(150000);
    expect(averageValue(0, 0)).toBe(0);
    expect(cancelRate(1, 3)).toBe(25);
    expect(cancelRate(0, 0)).toBe(0);
  });

  it('mô tả thay đổi và đảo màu cho chỉ số tăng là xấu', () => {
    expect(describeDelta(20)).toEqual({ text: '+20% so với kỳ trước', tone: 'good' });
    expect(describeDelta(-10)).toEqual({ text: '−10% so với kỳ trước', tone: 'bad' });
    expect(describeDelta(20, true).tone).toBe('bad');
    expect(describeDelta(0).tone).toBe('flat');
    expect(describeDelta(null).tone).toBe('flat');
  });
});

describe('top sản phẩm', () => {
  const parts = [
    [
      { productId: 1, sold: 2 },
      { productId: 2, sold: 5 },
      { productId: null, sold: 9 },
    ],
    [
      { productId: 1, sold: 4 },
      { productId: 3, sold: 6 },
      { productId: 4, sold: 0 },
      { productId: 5, sold: 1 },
    ],
  ] as const;

  it('gộp đơn một mẫu và nhiều mẫu, bỏ sản phẩm đã xóa, hòa thì id nhỏ trước', () => {
    expect(mergeTopProducts(parts, 3)).toEqual([
      { productId: 1, sold: 6 },
      { productId: 3, sold: 6 },
      { productId: 2, sold: 5 },
    ]);
  });

  it('top bán ít nhất: sold > 0, tăng dần, hòa thì id nhỏ trước', () => {
    expect(mergeLeastProducts(parts, 3)).toEqual([
      { productId: 5, sold: 1 },
      { productId: 2, sold: 5 },
      { productId: 1, sold: 6 },
    ]);
  });
});
