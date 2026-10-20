import { formatVnd } from '../../lib/money';

export const DISCOUNT_KINDS = ['percent', 'fixed'] as const;
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];

export const DISCOUNT_PERCENT_MAX = 90;
export const DISCOUNT_FIXED_MIN = 1_000;
export const DISCOUNT_CODE_MAX = 20;

export type DiscountRule = {
  code: string;
  kind: DiscountKind;
  value: number;
  minSubtotal: number;
  usageLimit: number | null;
  usedCount: number;
  startsAt: number | null;
  endsAt: number | null;
  active: boolean;
};

export type DiscountQuote = {
  code: string;
  subtotal: number;
  discountAmount: number;
  totalPrice: number;
};

export function isDiscountKind(value: string): value is DiscountKind {
  return (DISCOUNT_KINDS as readonly string[]).includes(value);
}

// Mã lưu chữ hoa, không dấu cách. Khách gõ thường vẫn khớp.
export function normalizeDiscountCode(value: string): string | null {
  const code = value.trim().toUpperCase().replace(/\s+/g, '');
  return /^[A-Z0-9]{3,20}$/.test(code) ? code : null;
}

// Ô datetime-local hiểu theo giờ Việt Nam, lưu mili-giây UTC.
export function parseDiscountTime(value: string): number | null {
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) return null;
  const time = Date.parse(`${text}:00+07:00`);
  return Number.isFinite(time) ? time : null;
}

export function formatDiscountTime(timestamp: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')}T${read('hour')}:${read('minute')}`;
}

// null khi mã dùng được. Lời nhắn là lý do từ chối, chưa tính số tiền.
export function discountBlockReason(rule: DiscountRule | null, subtotal: number, now: number): string | null {
  if (!Number.isInteger(subtotal) || subtotal < 0) return 'Chưa tính được tạm tính.';
  if (!rule) return 'Mã không tồn tại.';
  if (!rule.active) return 'Mã đang tắt.';
  if (rule.startsAt !== null && now < rule.startsAt) return 'Mã chưa tới hạn.';
  if (rule.endsAt !== null && now >= rule.endsAt) return 'Mã đã hết hạn.';
  if (rule.usageLimit !== null && rule.usedCount >= rule.usageLimit) return 'Mã đã hết lượt.';
  if (subtotal < rule.minSubtotal) return `Đơn chưa đủ ${formatVnd(rule.minSubtotal)} để dùng mã này.`;
  if (rule.kind === 'percent' && (rule.value < 1 || rule.value > DISCOUNT_PERCENT_MAX)) return 'Mã không dùng được.';
  if (rule.kind === 'fixed' && rule.value < 1) return 'Mã không dùng được.';
  return null;
}

export function quoteDiscount(rule: DiscountRule | null, subtotal: number, now: number): { ok: true; quote: DiscountQuote } | { ok: false; error: string } {
  const blocked = discountBlockReason(rule, subtotal, now);
  if (blocked || !rule) return { ok: false, error: blocked ?? 'Mã không tồn tại.' };
  const raw = rule.kind === 'percent' ? Math.floor((subtotal * rule.value) / 100) : rule.value;
  const discountAmount = Math.min(Math.max(0, raw), subtotal);
  if (discountAmount < 1) return { ok: false, error: 'Mã không giảm được đơn này.' };
  return { ok: true, quote: { code: rule.code, subtotal, discountAmount, totalPrice: subtotal - discountAmount } };
}

export function applyDiscount(subtotal: number, discount: DiscountQuote | null): {
  subtotal: number;
  discountCode: string | null;
  discountAmount: number;
  totalPrice: number;
} {
  if (!discount) return { subtotal, discountCode: null, discountAmount: 0, totalPrice: subtotal };
  return {
    subtotal: discount.subtotal,
    discountCode: discount.code,
    discountAmount: discount.discountAmount,
    totalPrice: discount.totalPrice,
  };
}
