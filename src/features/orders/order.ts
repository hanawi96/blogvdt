import { cartSummary, type CartLine } from '../cart/cart';
import { calendarRange } from '../../lib/datetime';
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
  return calendarRange(from, to);
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
  items?: { productName: string; optionLabel: string | null; quantity: number; lineTotal: number }[];
}): string {
  const lines = [
    `Mã: ${order.code}`,
    `Khách: ${order.customerName}`,
    `SĐT: ${order.phone}`,
    `Địa chỉ: ${order.address}`,
  ];
  if (order.items && order.items.length > 0) {
    lines.push('Sản phẩm:');
    for (const item of order.items) {
      lines.push(`- ${item.productName}${item.optionLabel ? ` (${item.optionLabel})` : ''} × ${item.quantity} — ${formatVnd(item.lineTotal)}`);
    }
    lines.push(`Tổng: ${formatVnd(order.totalPrice)}`);
  } else {
    lines.push(
      `Sản phẩm: ${order.productName}${order.optionLabel ? ` (${order.optionLabel})` : ''}`,
      `Số lượng: ${order.quantity}`,
      `Đơn giá: ${formatVnd(order.unitPrice)}`,
      `Tổng: ${formatVnd(order.totalPrice)}`,
    );
  }
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

export type CartLineDraft = {
  productId: number;
  productName: string;
  unitPrice: number;
  quantity: number;
  optionLabel: string | null;
  lineTotal: number;
};

export type CartOrderDraft = {
  customerName: string;
  phone: string;
  address: string;
  note: string;
  lines: CartLineDraft[];
  productName: string;
  quantity: number;
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
  const customer = readCustomer(input);
  const errors: FieldErrors = { ...customer.errors };
  const quantity = Number(input.quantity);
  const product = catalog.find((item) => item.slug === input.productSlug);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > ORDER_MAX_QUANTITY) {
    errors.quantity = `Số lượng là số nguyên từ 1 đến ${ORDER_MAX_QUANTITY}.`;
  }
  if (!product) errors.productSlug = 'Chọn sản phẩm đang bán.';
  const option = input.option.trim();
  if (product && product.options.length > 0 && !product.options.includes(option)) errors.option = 'Chọn một lựa chọn của sản phẩm.';
  if (product && product.options.length === 0 && option) errors.option = 'Sản phẩm này không có lựa chọn.';
  if (Object.keys(errors).length > 0 || !product || !customer.phone || !Number.isInteger(quantity)) {
    return { ok: false, blocked: false, errors };
  }
  return {
    ok: true,
    draft: {
      customerName: customer.customerName,
      phone: customer.phone,
      address: customer.address,
      note: customer.note,
      productId: product.id,
      productName: product.name,
      unitPrice: product.price,
      quantity,
      optionLabel: option || null,
      totalPrice: product.price * quantity,
    },
  };
}

export function parseCartOrder(
  input: {
    customerName: string;
    phone: string;
    address: string;
    note: string;
    company: string;
    lines: CartLine[];
  },
  catalog: CatalogProduct[],
): { ok: true; single: OrderDraft | null; cart: CartOrderDraft | null } | { ok: false; blocked: boolean; errors: FieldErrors } {
  if (input.company.trim()) return { ok: false, blocked: true, errors: {} };
  const customer = readCustomer(input);
  const errors: FieldErrors = { ...customer.errors };
  if (input.lines.length < 1) errors.cart = 'Giỏ đang trống.';
  const built: CartLineDraft[] = [];
  for (const [index, line] of input.lines.entries()) {
    const product = catalog.find((item) => item.slug === line.slug);
    if (!product) {
      errors.cart = 'Một mẫu trong giỏ không còn bán.';
      continue;
    }
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > ORDER_MAX_QUANTITY) {
      errors[`quantity${index}`] = `Số lượng là số nguyên từ 1 đến ${ORDER_MAX_QUANTITY}.`;
    }
    if (product.options.length > 0 && !product.options.includes(line.option)) errors[`option${index}`] = 'Chọn một lựa chọn của sản phẩm.';
    if (product.options.length === 0 && line.option) errors[`option${index}`] = 'Sản phẩm này không có lựa chọn.';
    if (errors[`option${index}`] || errors[`quantity${index}`]) continue;
    built.push({
      productId: product.id,
      productName: product.name,
      unitPrice: product.price,
      quantity: line.quantity,
      optionLabel: line.option || null,
      lineTotal: product.price * line.quantity,
    });
  }
  if (Object.keys(errors).length > 0 || !customer.phone || built.length !== input.lines.length) {
    return { ok: false, blocked: false, errors };
  }
  const line = built[0];
  if (built.length === 1 && line) {
    return {
      ok: true,
      cart: null,
      single: {
        customerName: customer.customerName,
        phone: customer.phone,
        address: customer.address,
        note: customer.note,
        productId: line.productId,
        productName: line.productName,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        optionLabel: line.optionLabel,
        totalPrice: line.lineTotal,
      },
    };
  }
  return {
    ok: true,
    single: null,
    cart: {
      customerName: customer.customerName,
      phone: customer.phone,
      address: customer.address,
      note: customer.note,
      lines: built,
      productName: cartSummary(built.map((item) => item.productName)),
      quantity: built.reduce((sum, item) => sum + item.quantity, 0),
      totalPrice: built.reduce((sum, item) => sum + item.lineTotal, 0),
    },
  };
}

function readCustomer(input: { customerName: string; phone: string; address: string; note: string }): {
  errors: FieldErrors;
  customerName: string;
  phone: string | null;
  address: string;
  note: string;
} {
  const errors: FieldErrors = {};
  const customerName = input.customerName.trim();
  const address = input.address.trim();
  const note = input.note.trim();
  const phone = normalizePhone(input.phone);
  if (customerName.length < 1 || customerName.length > 80) errors.customerName = 'Nhập họ tên, tối đa 80 ký tự.';
  if (!phone) errors.phone = 'Số điện thoại chưa đúng.';
  if (address.length < 8 || address.length > 240) errors.address = 'Nhập địa chỉ nhận hàng, từ 8 đến 240 ký tự.';
  if (note.length > 500) errors.note = 'Ghi chú tối đa 500 ký tự.';
  return { errors, customerName, phone, address, note };
}
