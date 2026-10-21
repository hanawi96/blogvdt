import { describe, expect, it } from 'vitest';
import { formatVnd } from '../../lib/money';
import {
  applyDiscount,
  discountBlockReason,
  discountSpan,
  formatDiscountTime,
  normalizeDiscountCode,
  parseDiscountTime,
  quoteDiscount,
  type DiscountRule,
} from './quote';

const now = Date.parse('2026-10-20T12:00:00+07:00');

function rule(patch: Partial<DiscountRule> = {}): DiscountRule {
  return {
    code: 'SALE10',
    kind: 'percent',
    value: 10,
    minSubtotal: 0,
    usageLimit: null,
    usedCount: 0,
    startsAt: null,
    endsAt: null,
    active: true,
    ...patch,
  };
}

describe('mã giảm giá', () => {
  it('chuẩn hóa mã và giờ Việt Nam', () => {
    expect(normalizeDiscountCode(' sale10 ')).toBe('SALE10');
    expect(normalizeDiscountCode('ab')).toBeNull();
    expect(normalizeDiscountCode('SALE-10')).toBeNull();
    const time = parseDiscountTime('2026-10-20T19:00');
    expect(time).toBe(Date.parse('2026-10-20T19:00:00+07:00'));
    expect(time !== null && formatDiscountTime(time)).toBe('2026-10-20T19:00');
    expect(parseDiscountTime('2026-10-20')).toBeNull();
  });

  it('mốc nhanh tính từ phút hiện tại theo giờ Việt Nam', () => {
    const now = Date.parse('2026-01-31T12:24:40+07:00');
    expect(discountSpan(now, '1d')).toEqual({ startsAt: '2026-01-31T12:24', endsAt: '2026-02-01T12:24' });
    expect(discountSpan(now, '7d').endsAt).toBe('2026-02-07T12:24');
    expect(discountSpan(now, '1m').endsAt).toBe('2026-02-28T12:24');
    expect(discountSpan(now, '3m').endsAt).toBe('2026-04-30T12:24');
    expect(discountSpan(now, '6m').endsAt).toBe('2026-07-31T12:24');
    expect(discountSpan(Date.parse('2024-01-31T08:00:00+07:00'), '1m').endsAt).toBe('2024-02-29T08:00');
  });

  it('giảm phần trăm làm tròn xuống và giảm số tiền không vượt tạm tính', () => {
    const percent = quoteDiscount(rule(), 200_000, now);
    expect(percent.ok && percent.quote).toEqual({ code: 'SALE10', subtotal: 200_000, discountAmount: 20_000, totalPrice: 180_000 });
    const odd = quoteDiscount(rule(), 199_999, now);
    expect(odd.ok && odd.quote.discountAmount).toBe(19_999);
    const fixed = quoteDiscount(rule({ kind: 'fixed', value: 60_000, code: 'GIAM60' }), 200_000, now);
    expect(fixed.ok && fixed.quote).toEqual({ code: 'GIAM60', subtotal: 200_000, discountAmount: 60_000, totalPrice: 140_000 });
    const cover = quoteDiscount(rule({ kind: 'fixed', value: 250_000, code: 'FULL' }), 200_000, now);
    expect(cover.ok && cover.quote.totalPrice).toBe(0);
    expect(cover.ok && cover.quote.discountAmount).toBe(200_000);
  });

  it('từ chối mã tắt, chưa tới hạn, hết hạn, hết lượt hoặc chưa đủ đơn', () => {
    expect(discountBlockReason(null, 200_000, now)).toMatch(/không tồn tại/);
    expect(discountBlockReason(rule({ active: false }), 200_000, now)).toMatch(/tắt/);
    expect(discountBlockReason(rule({ startsAt: now + 1 }), 200_000, now)).toMatch(/chưa tới hạn/);
    expect(discountBlockReason(rule({ startsAt: now }), 200_000, now)).toBeNull();
    expect(discountBlockReason(rule({ endsAt: now }), 200_000, now)).toMatch(/hết hạn/);
    expect(discountBlockReason(rule({ endsAt: now + 1 }), 200_000, now)).toBeNull();
    expect(discountBlockReason(rule({ usageLimit: 10, usedCount: 10 }), 200_000, now)).toMatch(/hết lượt/);
    expect(discountBlockReason(rule({ usageLimit: 10, usedCount: 9 }), 200_000, now)).toBeNull();
    expect(discountBlockReason(rule({ minSubtotal: 200_000 }), 199_000, now)).toBe(`Đơn chưa đủ ${formatVnd(200_000)} để dùng mã này.`);
    expect(quoteDiscount(rule({ value: 10 }), 0, now).ok).toBe(false);
  });

  it('đơn không có mã giữ nguyên tạm tính', () => {
    expect(applyDiscount(200_000, null)).toEqual({ subtotal: 200_000, discountCode: null, discountAmount: 0, totalPrice: 200_000 });
  });
});
