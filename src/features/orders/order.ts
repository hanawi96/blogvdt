import type { FieldErrors } from '../../lib/validation/errors';
import { formatVnd } from '../../lib/money';

export const ORDER_DUPLICATE_MS = 10 * 60 * 1000;
export const ORDER_IP_LIMIT = 5;
export const ORDER_IP_WINDOW_MS = 15 * 60 * 1000;
export const ORDER_MAX_QUANTITY = 20;

export type CatalogProduct = {
  id: number;
  slug: string;
  name: string;
  price: number;
  options: string[];
};

export function orderCreatedRange(from: string, to: string): { start: number | null; end: number | null; invalid: boolean } {
  const start = vnDayStart(from);
  const endDay = vnDayStart(to);
  if ((from !== '' && start === null) || (to !== '' && endDay === null)) return { start: null, end: null, invalid: true };
  if (start !== null && endDay !== null && endDay < start) return { start, end: null, invalid: true };
  return { start, end: endDay === null ? null : endDay + 86_400_000, invalid: false };
}

function vnDayStart(value: string): number | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00+07:00`);
  return Number.isFinite(time) ? time : null;
}

export function orderHandoffText(order: {
  code: string;
  customerName: string;
  phone: string;
  address: string;
  productName: string;
  optionLabel: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  note: string | null;
  internalNote: string | null;
}): string {
  const lines = [
    `Mã: ${order.code}`,
    `Khách: ${order.customerName}`,
    `SĐT: ${order.phone}`,
    `Địa chỉ: ${order.address}`,
    `Sản phẩm: ${order.productName}${order.optionLabel ? ` (${order.optionLabel})` : ''}`,
    `Số lượng: ${order.quantity}`,
    `Đơn giá: ${formatVnd(order.unitPrice)}`,
    `Tổng: ${formatVnd(order.totalPrice)}`,
  ];
  if (order.note) lines.push(`Ghi chú khách: ${order.note}`);
  if (order.internalNote) lines.push(`Ghi chú nội bộ: ${order.internalNote}`);
  return lines.join('\n');
}

export type OrderDraft = {
  customerName: string;
  phone: string;
  address: string;
  note: string;
  productId: number;
  productName: string;
  unitPrice: number;
  quantity: number;
  optionLabel: string | null;
  totalPrice: number;
};

export function normalizePhone(value: string): string | null {
  const compact = value.replace(/[\s.\-()]/g, '');
  const local = compact.startsWith('+84') ? `0${compact.slice(3)}` : compact.startsWith('84') && compact.length >= 11 ? `0${compact.slice(2)}` : compact;
  return /^0\d{9,10}$/.test(local) ? local : null;
}

export function orderDayKey(now: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(now));
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${read('year')}${read('month')}${read('day')}`;
}

export function formatOrderCode(day: string, sequence: number): string {
  return `VD${day}-${String(sequence).padStart(4, '0')}`;
}

export function sequenceFromCode(code: string): number {
  const value = Number(code.slice(-4));
  return Number.isInteger(value) && value > 0 ? value : 0;
}

export function isRecentDuplicate(createdAt: number, now: number): boolean {
  return now - createdAt < ORDER_DUPLICATE_MS;
}

// Drizzle bọc lỗi D1 trong DrizzleQueryError; thông báo UNIQUE nằm ở `cause`.
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    if (current.message.includes('UNIQUE constraint failed')) return true;
    current = current.cause;
  }
  return false;
}

export function parseOrderSubmission(
  input: {
    customerName: string;
    phone: string;
    address: string;
    note: string;
    productSlug: string;
    quantity: string;
    option: string;
    company: string;
  },
  catalog: CatalogProduct[],
): { ok: true; draft: OrderDraft } | { ok: false; blocked: boolean; errors: FieldErrors } {
  if (input.company.trim()) return { ok: false, blocked: true, errors: {} };
  const errors: FieldErrors = {};
  const customerName = input.customerName.trim();
  const address = input.address.trim();
  const note = input.note.trim();
  const phone = normalizePhone(input.phone);
  const quantity = Number(input.quantity);
  const product = catalog.find((item) => item.slug === input.productSlug);
  if (customerName.length < 1 || customerName.length > 80) errors.customerName = 'Nhập họ tên, tối đa 80 ký tự.';
  if (!phone) errors.phone = 'Số điện thoại chưa đúng.';
  if (address.length < 8 || address.length > 240) errors.address = 'Nhập địa chỉ nhận hàng, từ 8 đến 240 ký tự.';
  if (note.length > 500) errors.note = 'Ghi chú tối đa 500 ký tự.';
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > ORDER_MAX_QUANTITY) {
    errors.quantity = `Số lượng là số nguyên từ 1 đến ${ORDER_MAX_QUANTITY}.`;
  }
  if (!product) errors.productSlug = 'Chọn sản phẩm đang bán.';
  const option = input.option.trim();
  if (product && product.options.length > 0 && !product.options.includes(option)) errors.option = 'Chọn một lựa chọn của sản phẩm.';
  if (product && product.options.length === 0 && option) errors.option = 'Sản phẩm này không có lựa chọn.';
  if (Object.keys(errors).length > 0 || !product || !phone || !Number.isInteger(quantity)) {
    return { ok: false, blocked: false, errors };
  }
  return {
    ok: true,
    draft: {
      customerName,
      phone,
      address,
      note,
      productId: product.id,
      productName: product.name,
      unitPrice: product.price,
      quantity,
      optionLabel: option || null,
      totalPrice: product.price * quantity,
    },
  };
}
