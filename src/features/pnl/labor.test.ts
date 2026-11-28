import { describe, expect, it } from 'vitest';
import { parseLaborMonthKey } from './labor';

describe('parseLaborMonthKey', () => {
  it('chấp nhận YYYY-MM hợp lệ', () => {
    expect(parseLaborMonthKey('2026-11')).toBe('2026-11');
    expect(parseLaborMonthKey(' 2026-01 ')).toBe('2026-01');
  });

  it('từ chối tháng sai', () => {
    expect(parseLaborMonthKey('2026-13')).toBeNull();
    expect(parseLaborMonthKey('26-11')).toBeNull();
    expect(parseLaborMonthKey('2026-11-01')).toBeNull();
  });
});
