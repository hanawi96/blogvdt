import { describe, expect, it } from 'vitest';
import { groupDigits } from './group-digits';

describe('phân cách hàng nghìn', () => {
  it('đổi 25000 thành 25.000', () => {
    expect(groupDigits('25000', 12)).toBe('25.000');
    expect(groupDigits('25.000', 12)).toBe('25.000');
    expect(groupDigits('1500000', 12)).toBe('1.500.000');
  });

  it('giữ số nhỏ và số 0', () => {
    expect(groupDigits('999', 12)).toBe('999');
    expect(groupDigits('0', 12)).toBe('0');
    expect(groupDigits('', 12)).toBe('');
    expect(groupDigits('00025', 12)).toBe('25');
  });

  it('không nhận quá số chữ số của ô', () => {
    expect(groupDigits('123456789', 8)).toBe('12.345.678');
  });
});