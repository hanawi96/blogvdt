import { describe, expect, it } from 'vitest';
import { adDayKey, adSpendFor, parseAdDay, recentDayKeys } from './ads';

describe('ngày quảng cáo', () => {
  it('chỉ nhận ngày có thật', () => {
    expect(parseAdDay('2026-10-17')).toBe('2026-10-17');
    expect(parseAdDay('2026-02-31')).toBeNull();
    expect(parseAdDay('17/10/2026')).toBeNull();
    expect(parseAdDay('')).toBeNull();
  });

  it('lấy ngày theo giờ Việt Nam', () => {
    // 2026-10-17 18:00 UTC đã là 01:00 ngày 18 ở Việt Nam.
    expect(adDayKey(Date.UTC(2026, 9, 17, 18, 0, 0))).toBe('2026-10-18');
  });

  it('liệt kê N ngày gần nhất, có thể lùi thêm kỳ trước', () => {
    const now = Date.UTC(2026, 9, 17, 5, 0, 0);
    expect(recentDayKeys(now, 3)).toEqual(['2026-10-17', '2026-10-16', '2026-10-15']);
    expect(recentDayKeys(now, 2, 3)).toEqual(['2026-10-14', '2026-10-13']);
  });
});

describe('tổng quảng cáo', () => {
  const days = ['2026-10-17', '2026-10-16', '2026-10-15'];

  it('không có dữ liệu thì bằng 0', () => {
    expect(adSpendFor(days, [])).toBe(0);
  });

  it('mức chung chỉ áp dụng từ ngày bắt đầu, không sửa lịch sử', () => {
    const rows = [
      { kind: 'rate' as const, day: '2026-10-01', amount: 220000 },
      { kind: 'rate' as const, day: '2026-10-17', amount: 300000 },
    ];
    expect(adSpendFor(days, rows)).toBe(220000 + 220000 + 300000);
  });

  it('ngày trước mức đầu tiên không bị tính', () => {
    expect(adSpendFor(days, [{ kind: 'rate', day: '2026-10-16', amount: 100000 }])).toBe(200000);
  });

  it('số riêng của một ngày thay cho mức chung, kể cả bằng 0', () => {
    const rows = [
      { kind: 'rate' as const, day: '2026-10-01', amount: 220000 },
      { kind: 'day' as const, day: '2026-10-16', amount: 0 },
      { kind: 'day' as const, day: '2026-10-15', amount: 500000 },
    ];
    expect(adSpendFor(days, rows)).toBe(220000 + 0 + 500000);
  });
});
