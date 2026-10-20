import { describe, expect, it } from 'vitest';
import { readDiscountInput } from './discounts';

const blank = {
  code: 'sale10',
  kind: 'percent',
  value: '10',
  minSubtotal: '',
  usageLimit: '',
  startsAt: '',
  endsAt: '',
  active: true,
  note: '',
};

describe('nhập mã giảm giá', () => {
  it('nhận phần trăm và số tiền hợp lệ', () => {
    const percent = readDiscountInput(blank);
    expect(percent.ok && percent.draft.code).toBe('SALE10');
    expect(percent.ok && percent.draft.value).toBe(10);
    const fixed = readDiscountInput({ ...blank, kind: 'fixed', value: '60.000', code: 'GIAM60' });
    expect(fixed.ok && fixed.draft).toMatchObject({ code: 'GIAM60', kind: 'fixed', value: 60_000, minSubtotal: 0, usageLimit: null });
  });

  it('từ chối mức sai, hạn ngược và mã đã có ký tự lạ', () => {
    expect(readDiscountInput({ ...blank, value: '91' }).ok).toBe(false);
    expect(readDiscountInput({ ...blank, kind: 'fixed', value: '500' }).ok).toBe(false);
    expect(readDiscountInput({ ...blank, code: 'SALE-10' }).ok).toBe(false);
    expect(readDiscountInput({ ...blank, code: 'SALE 10' }).ok).toBe(false);
    const lower = readDiscountInput({ ...blank, code: 'sale10' });
    expect(lower.ok && lower.draft.code).toBe('SALE10');
    const backwards = readDiscountInput({ ...blank, startsAt: '2026-10-21T10:00', endsAt: '2026-10-20T10:00' });
    expect(backwards.ok).toBe(false);
    if (!backwards.ok) expect(backwards.error).toMatch(/kết thúc/);
  });
});
