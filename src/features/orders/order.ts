import { cartSummary, type CartLine } from '../cart/cart';
import {
  addonUnitWithBundleOffers,
  catalogUnitWithComboOffers,
  type AddonBundleOffer,
  type ComboOffer,
} from '../home-collections/collections';
import { SLUG_PATTERN } from '../posts/slug';
import { productRequiresTagName, readTagName, tagNameToLineNote } from '../products/tag-name';
import {
  applyWeightPrice,
  isValidWeight,
  normalizeWeightForStorage,
  requiresWeight,
  type WeightScale,
} from '../products/weight';
import { DEFAULT_PAYMENT_METHOD, isPaymentMethod, paymentLabel, type PaymentMethod } from './payment';
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
  weightScale: WeightScale;
  categorySlug?: string;
};

export type ComboOffersByProduct = ReadonlyMap<number, readonly ComboOffer[]>;

/** Đơn giá đã áp giảm combo (nếu đủ SL) rồi phụ thu cân nặng. */
export function lineUnitPrice(
  product: Pick<CatalogProduct, 'id' | 'price'>,
  quantity: number,
  weight: string,
  comboOffers?: ComboOffersByProduct,
  addonOffers?: readonly AddonBundleOffer[],
  orderProductIds?: ReadonlySet<number>,
): number {
  const comboBase = catalogUnitWithComboOffers(product.price, product.id, quantity, comboOffers);
  const withAddon =
    orderProductIds && addonOffers?.length
      ? addonUnitWithBundleOffers(comboBase, product.id, orderProductIds, addonOffers)
      : comboBase;
  return applyWeightPrice(withAddon, weight);
}

export function orderCreatedRange(from: string, to: string): { start: number | null; end: number | null; invalid: boolean } {
  return calendarRange(from, to);
}

function pushPayable(
  lines: string[],
  order: {
    subtotal?: number | null;
    discountCode?: string | null;
    discountAmount?: number;
    shippingFee?: number;
    totalPrice: number;
  },
): void {
  if (order.discountAmount && order.discountAmount > 0) {
    lines.push(`Tạm tính: ${formatVnd(order.subtotal ?? order.totalPrice + order.discountAmount - (order.shippingFee ?? 0))}`);
    lines.push(`Giảm ${order.discountCode || 'giá'}: −${formatVnd(order.discountAmount)}`);
  }
  if ((order.shippingFee ?? 0) > 0) lines.push(`Ship: ${formatVnd(order.shippingFee ?? 0)}`);
  else if (order.shippingFee === 0) lines.push('Ship: miễn phí');
  lines.push(`Tổng: ${formatVnd(order.totalPrice)}`);
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
  paymentMethod?: string;
  subtotal?: number | null;
  discountCode?: string | null;
  discountAmount?: number;
  shippingFee?: number;
  items?: { productName: string; optionLabel: string | null; quantity: number; lineTotal: number }[];
}): string {
  const lines = [
    `Mã: ${order.code}`,
    `Khách: ${order.customerName}`,
    `SĐT: ${order.phone}`,
    `Địa chỉ: ${order.address}`,
  ];
  if (order.paymentMethod) lines.push(`Thanh toán: ${paymentLabel(order.paymentMethod)}`);
  if (order.items && order.items.length > 0) {
    lines.push('Sản phẩm:');
    for (const item of order.items) {
      lines.push(`- ${item.productName}${item.optionLabel ? ` (${item.optionLabel})` : ''} × ${item.quantity} — ${formatVnd(item.lineTotal)}`);
    }
    pushPayable(lines, order);
  } else {
    lines.push(
      `Sản phẩm: ${order.productName}${order.optionLabel ? ` (${order.optionLabel})` : ''}`,
      `Số lượng: ${order.quantity}`,
      `Đơn giá: ${formatVnd(order.unitPrice)}`,
    );
    pushPayable(lines, order);
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
  /** Lưu ý dòng SP (tên in thẻ), ghi vào order_items khi có. */
  lineNote: string | null;
  productId: number;
  productName: string;
  unitPrice: number;
  quantity: number;
  optionLabel: string | null;
  subtotal: number;
  discountCode: string | null;
  discountAmount: number;
  totalPrice: number;
  shippingFee?: number;
  paymentMethod: PaymentMethod;
  landingSlug: string | null;
};

// Nguồn chiến dịch (query ?landing=) đi kèm đơn để đo chuyển đổi. Chỉ nhận slug hợp lệ.
export function readLandingSlug(value: string): string | null {
  const slug = value.trim().slice(0, 180);
  return slug && SLUG_PATTERN.test(slug) ? slug : null;
}

export type CartLineDraft = {
  productId: number;
  productName: string;
  unitPrice: number;
  quantity: number;
  optionLabel: string | null;
  note: string | null;
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
  subtotal: number;
  discountCode: string | null;
  discountAmount: number;
  totalPrice: number;
  shippingFee?: number;
  paymentMethod: PaymentMethod;
};

// Nhãn bổ sung lưu kèm đơn: hiện chỉ còn cân nặng của bé (nếu có).
// «Chưa sinh» (UI) → «3kg» khi ghi DB.
export function orderOptionLabel(weight: string): string | null {
  const value = normalizeWeightForStorage(weight);
  return value.length > 0 ? value : null;
}

/** Thân máy VN (9 số sau số 0): 03x/05x/07x/08x/09x. */
const VN_MOBILE_BODY_RE = /^(?:3[2-9]|5[2689]|7[06-9]|8[1-9]|9\d)\d{7}$/;

/**
 * Chuẩn hóa SĐT di động Việt Nam → `0xxxxxxxxx` (10 số).
 * Nhận: 0386 190 596 | +84386190596 | 84386190596 | 84386 190 596 | 386 190 596 | 0386190596…
 * Trả null nếu không phải mobile VN hợp lệ.
 */
export function normalizePhone(value: string): string | null {
  // Chỉ giữ chữ số — bỏ +, khoảng trắng, dấu chấm/gạch/ngoặc.
  let digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return null;

  // Bỏ mã quốc gia 84 (+84 / 84 / 840…).
  if (digits.startsWith('84') && digits.length >= 11) {
    digits = digits.slice(2);
  }

  // Khách hay bỏ số 0 đầu → còn 9 số thân máy.
  if (digits.length === 9 && VN_MOBILE_BODY_RE.test(digits)) {
    digits = `0${digits}`;
  }

  // Kết quả chuẩn: 0 + 9 số đầu mạng hợp lệ.
  if (digits.length === 10 && digits.startsWith('0') && VN_MOBILE_BODY_RE.test(digits.slice(1))) {
    return digits;
  }
  return null;
}

/** Tách ô tìm đơn/khách: SĐT thuần → phone; còn lại → text (đã bỏ ký tự LIKE). */
export function orderSearchTerm(query: string): { text: string; phone: string } {
  const text = query.replace(/[%_]/g, '').trim().slice(0, 80);
  const digits = text.replace(/\D/g, '');
  if (/^[\d\s.+\-()]+$/.test(text) && digits.length >= 8) return { text: '', phone: normalizePhone(text) ?? digits };
  return { text, phone: '' };
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
    weight?: string;
    tagName?: string;
    paymentMethod?: string;
    company: string;
    landing?: string;
  },
  catalog: CatalogProduct[],
  comboOffers?: ComboOffersByProduct,
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
  // Form không gửi hình thức thì mặc định thanh toán khi nhận hàng; giá trị lạ bị từ chối.
  const paymentRaw = (input.paymentMethod ?? '').trim();
  if (paymentRaw && !isPaymentMethod(paymentRaw)) errors.paymentMethod = 'Chọn hình thức thanh toán.';
  const paymentMethod = isPaymentMethod(paymentRaw) ? paymentRaw : DEFAULT_PAYMENT_METHOD;
  const weight = (input.weight ?? '').trim();
  if (product && requiresWeight(product.weightScale) && !weight) errors.weight = 'Chọn cân nặng cho bé.';
  else if (product && !isValidWeight(product.weightScale, weight)) errors.weight = 'Cân nặng không hợp lệ.';
  let lineNote: string | null = null;
  if (product && productRequiresTagName(product.name)) {
    const tag = readTagName(input.tagName ?? '');
    if (tag === null) errors.tagName = 'Nhập tên cần in lên thẻ.';
    else if (tag === 'bad') errors.tagName = 'Tên in thẻ tối đa 40 ký tự.';
    else lineNote = tagNameToLineNote(tag);
  }
  if (Object.keys(errors).length > 0 || !product || !customer.phone || !Number.isInteger(quantity)) {
    return { ok: false, blocked: false, errors };
  }
  const unitPrice = lineUnitPrice(product, quantity, weight, comboOffers);
  return {
    ok: true,
    draft: {
      customerName: customer.customerName,
      phone: customer.phone,
      address: customer.address,
      note: customer.note,
      lineNote,
      productId: product.id,
      productName: product.name,
      unitPrice,
      quantity,
      optionLabel: orderOptionLabel(weight),
      subtotal: unitPrice * quantity,
      discountCode: null,
      discountAmount: 0,
      totalPrice: unitPrice * quantity,
      paymentMethod,
      landingSlug: readLandingSlug(input.landing ?? ''),
    },
  };
}

export function parseCartOrder(
  input: {
    customerName: string;
    phone: string;
    address: string;
    note: string;
    paymentMethod?: string;
    company: string;
    lines: CartLine[];
  },
  catalog: CatalogProduct[],
  comboOffers?: ComboOffersByProduct,
  addonOffers?: readonly AddonBundleOffer[],
): { ok: true; single: OrderDraft | null; cart: CartOrderDraft | null } | { ok: false; blocked: boolean; errors: FieldErrors } {
  if (input.company.trim()) return { ok: false, blocked: true, errors: {} };
  const customer = readCustomer(input);
  const errors: FieldErrors = { ...customer.errors };
  const paymentRaw = (input.paymentMethod ?? '').trim();
  if (paymentRaw && !isPaymentMethod(paymentRaw)) errors.paymentMethod = 'Chọn hình thức thanh toán.';
  const paymentMethod = isPaymentMethod(paymentRaw) ? paymentRaw : DEFAULT_PAYMENT_METHOD;
  if (input.lines.length < 1) errors.cart = 'Giỏ đang trống.';
  const orderProductIds = new Set<number>();
  for (const line of input.lines) {
    const product = catalog.find((item) => item.slug === line.slug);
    if (product) orderProductIds.add(product.id);
  }
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
    if (requiresWeight(product.weightScale) && !line.weight) errors[`weight${index}`] = 'Chọn cân nặng cho bé.';
    if (!isValidWeight(product.weightScale, line.weight)) errors[`weight${index}`] = 'Cân nặng không hợp lệ.';
    let lineNote: string | null = null;
    if (productRequiresTagName(product.name)) {
      const tag = readTagName(line.note);
      if (tag === null) errors[`note${index}`] = 'Nhập tên cần in lên thẻ.';
      else if (tag === 'bad') errors[`note${index}`] = 'Tên in thẻ tối đa 40 ký tự.';
      else lineNote = tagNameToLineNote(tag);
    } else {
      const note = line.note.replace(/\s+/g, ' ').trim();
      if (note.length > 160) errors[`note${index}`] = 'Lưu ý tối đa 160 ký tự.';
      else if (note) lineNote = note;
    }
    if (errors[`quantity${index}`] || errors[`weight${index}`] || errors[`note${index}`]) continue;
    const unitPrice = lineUnitPrice(
      product,
      line.quantity,
      line.weight,
      comboOffers,
      addonOffers,
      orderProductIds,
    );
    built.push({
      productId: product.id,
      productName: product.name,
      unitPrice,
      quantity: line.quantity,
      optionLabel: orderOptionLabel(line.weight),
      note: lineNote,
      lineTotal: unitPrice * line.quantity,
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
        lineNote: line.note,
        productId: line.productId,
        productName: line.productName,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        optionLabel: line.optionLabel,
        subtotal: line.lineTotal,
        discountCode: null,
        discountAmount: 0,
        totalPrice: line.lineTotal,
        paymentMethod,
        landingSlug: null,
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
      subtotal: built.reduce((sum, item) => sum + item.lineTotal, 0),
      discountCode: null,
      discountAmount: 0,
      totalPrice: built.reduce((sum, item) => sum + item.lineTotal, 0),
      paymentMethod,
    },
  };
}

export function readCustomer(input: { customerName: string; phone: string; address: string; note: string }): {
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
