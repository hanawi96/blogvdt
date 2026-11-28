import { describe, expect, it } from 'vitest';
import { adjacentMonthKey, isPnlPresetActive, periodDayKeys, pnlPeriodPath, pnlQuickChipPresets, pnlQuickPresets, pnlRangeCaption, readPnlPeriod } from './period';

describe('readPnlPeriod', () => {
  const now = Date.parse('2026-11-28T10:00:00+07:00');

  it('mặc định tháng VN hiện tại', () => {
    const period = readPnlPeriod(new URLSearchParams(), now);
    expect(period.monthKey).toBe('2026-11');
    expect(period.from).toBe('2026-11-01');
    expect(period.to).toBe('2026-11-28');
    expect(period.label).toBe('Tháng 11');
  });

  it('đọc ?month=', () => {
    const period = readPnlPeriod(new URLSearchParams('month=2026-10'), now);
    expect(period.monthKey).toBe('2026-10');
    expect(period.from).toBe('2026-10-01');
    expect(period.to).toBe('2026-10-31');
    expect(period.label).toBe('Tháng 10');
  });

  it('đọc ?from=&to= khoảng tùy chỉnh', () => {
    const period = readPnlPeriod(new URLSearchParams('from=2026-11-01&to=2026-11-07'), now);
    expect(period.monthKey).toBeNull();
    expect(period.from).toBe('2026-11-01');
    expect(period.to).toBe('2026-11-07');
  });

  it('from/to đúng một tháng → gắn monthKey', () => {
    const period = readPnlPeriod(new URLSearchParams('from=2026-10-01&to=2026-10-31'), now);
    expect(period.monthKey).toBe('2026-10');
    expect(period.label).toBe('Tháng 10');
  });

  it('preset nhanh khớp biên start/end và dayKeys', () => {
    for (const preset of pnlQuickPresets(now)) {
      const period = readPnlPeriod(new URLSearchParams(`from=${preset.from}&to=${preset.to}`), now);
      expect(period.from).toBe(preset.from);
      expect(period.to).toBe(preset.to);
      expect(period.start).toBe(Date.parse(`${preset.from}T00:00:00+07:00`));
      expect(period.end).toBe(Date.parse(`${preset.to}T00:00:00+07:00`) + 86_400_000);
      expect(periodDayKeys(period.from, period.to)?.[0]).toBe(preset.from);
      expect(periodDayKeys(period.from, period.to)?.at(-1)).toBe(preset.to);
      expect(isPnlPresetActive(period, preset)).toBe(true);
    }
  });
});

describe('pnlQuickChipPresets', () => {
  it('đủ preset ngoài trang, N ngày là gần nhất', () => {
    const chips = pnlQuickChipPresets(Date.parse('2026-11-28T10:00:00+07:00'));
    expect(chips.map((item) => item.id)).toEqual(['today', 'yesterday', '7', '30', '60', '90']);
    expect(chips.find((item) => item.id === '7')).toMatchObject({
      label: '7 ngày gần nhất',
      from: '2026-11-22',
      to: '2026-11-28',
    });
    expect(chips.find((item) => item.id === '30')).toMatchObject({ from: '2026-10-30', to: '2026-11-28' });
  });
});

describe('pnlRangeCaption', () => {
  it('rút gọn khoảng ngày', () => {
    expect(pnlRangeCaption('2026-11-28', '2026-11-28')).toBe('28/11');
    expect(pnlRangeCaption('2026-11-22', '2026-11-28')).toBe('22–28/11');
  });
});

describe('adjacentMonthKey', () => {
  const now = Date.parse('2026-11-28T10:00:00+07:00');

  it('lùi/tới tháng và chặn tương lai', () => {
    expect(adjacentMonthKey('2026-11', -1, now)).toBe('2026-10');
    expect(adjacentMonthKey('2026-11', 1, now)).toBeNull();
    expect(adjacentMonthKey('2026-01', -1, now)).toBe('2025-12');
  });
});

describe('periodDayKeys', () => {
  it('liệt kê đủ ngày trong khoảng', () => {
    expect(periodDayKeys('2026-11-28', '2026-11-28')).toEqual(['2026-11-28']);
    expect(periodDayKeys('2026-11-29', '2026-12-01')).toEqual(['2026-11-29', '2026-11-30', '2026-12-01']);
  });

  it('từ chối khoảng sai', () => {
    expect(periodDayKeys('2026-12-02', '2026-12-01')).toBeNull();
    expect(periodDayKeys('bad', '2026-12-01')).toBeNull();
  });
});

describe('pnlPeriodPath', () => {
  it('luôn dùng from/to để khớp preset', () => {
    expect(pnlPeriodPath('/admin/pnl', { monthKey: '2026-11', from: '2026-11-01', to: '2026-11-28' })).toBe(
      '/admin/pnl?from=2026-11-01&to=2026-11-28',
    );
    expect(pnlPeriodPath('/admin/pnl', { monthKey: null, from: '2026-11-01', to: '2026-11-07' })).toBe(
      '/admin/pnl?from=2026-11-01&to=2026-11-07',
    );
  });
});
