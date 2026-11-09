import { CART_MAX_LINES, cartSummary } from '../cart/cart';
import { requiresWeight, type WeightScale } from '../products/weight';
import type { FieldErrors } from '../../lib/validation/errors';
import { DEFAULT_PAYMENT_METHOD, isPaymentMethod, paymentLabel, type PaymentMethod } from './payment';
import { ORDER_MAX_QUANTITY, orderOptionLabel, readCustomer } from './order';

export type StaffPricedLine = {
  productId: number | null;
  productName: string;
  unitPrice: number;
  quantity: number;
  optionLabel: string | null;
  lineTotal: number;
};

export const STAFF_MAX_LINES = CART_MAX_LINES;

export type StaffProductChoice = {
  id: number;
  name: string;
  price: number;
  weightScale: WeightScale;
  active: boolean;
};

export type StaffLineInput = {
  slot: string;
  productId: string;
  weight: string;
  quantity: string;
  price?: string;
  name?: string;
  note?: string;
};

export type StoredOrderLine = {
  productId: number | null;
  productName: string;
  unitPrice: number;
  quantity: number;
  optionLabel: string | null;
  lineTotal: number;
};

export type StaffOrderDraft = {
  customerName: string;
  phone: string;
  address: string;
  note: string;
  paymentMethod: PaymentMethod;
  lines: StaffPricedLine[];
  discountCode: string | null;
  orderTotal: string;
  discountExtra?: string;
  flags: StaffFlags;
};

const MONEY_MAX = 999_999_999;

export const ORDER_SOURCES = [
  { value: 'zalo', label: 'Zalo' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'web', label: 'Web' },
] as const;

export const PAY_STATES = [
  { value: 'cod', label: 'COD', paymentMethod: 'cod' },
  { value: 'paid', label: 'Đã CK', paymentMethod: 'bank' },
  { value: 'deposit', label: 'Cọc trước', paymentMethod: 'bank' },
] as const;

export type OrderSource = (typeof ORDER_SOURCES)[number]['value'];
export type PayState = (typeof PAY_STATES)[number]['value'];

export type StaffFlags = {
  source: OrderSource;
  payState: PayState;
  paymentMethod: PaymentMethod;
  priority: boolean;
  compensation: boolean;
  shipOn: number | null;
  shippingFee: number;
};

export type StaffFlagForm = {
  payState: string;
  source: string;
  priority: boolean;
  compensation: boolean;
  shipLater: boolean;
  shipOn: string;
  shippingFee: string;
  freeShip: boolean;
};

export function canEditOrderProducts(status: string): boolean {
  return status !== 'completed' && status !== 'cancelled';
}

export function readStaffLineInputs(form: FormData): StaffLineInput[] | null {
  const slots = texts(form, 'lineSlot');
  const productIds = texts(form, 'lineProduct');
  const weights = texts(form, 'lineWeight');
  const quantities = texts(form, 'lineQuantity');
  const prices = texts(form, 'linePrice');
  const names = texts(form, 'lineName');
  const notes = texts(form, 'lineNote');
  if (slots.length === 0 || productIds.length !== slots.length || weights.length !== slots.length || quantities.length !== slots.length || names.length !== slots.length) return null;
  if (prices.length !== 0 && prices.length !== slots.length) return null;
  if (notes.length !== 0 && notes.length !== slots.length) return null;
  return slots.map((slot, index) => ({
    slot,
    productId: productIds[index] ?? '',
    weight: weights[index] ?? '',
    quantity: quantities[index] ?? '',
    price: prices[index] ?? '',
    name: names[index] ?? '',
    note: notes[index] ?? '',
  }));
}

const LINE_NAME_MAX = 160;

// Tên gõ trên đơn chỉ lưu vào đơn. Không gửi thì giữ tên đã có.
function readLineName(raw: string | undefined, fallback: string): { ok: true; name: string } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, name: fallback };
  const name = raw.replace(/\s+/g, ' ').trim();
  if (!name) return { ok: false, error: 'Nhập tên sản phẩm.' };
  if (name.length > LINE_NAME_MAX) return { ok: false, error: 'Tên sản phẩm quá dài.' };
  return { ok: true, name };
}

// Không gõ đơn giá: dòng mới hoặc đổi mẫu/cân lấy giá đang bán, chỉ đổi số lượng thì giữ giá cũ.
// Có gõ đơn giá thì dùng số đó, kể cả khi thấp hoặc cao hơn giá đang bán.
export function priceStaffLines(
  inputs: StaffLineInput[],
  catalog: ReadonlyArray<{ id: number; name: string; price: number; weightScale: WeightScale }>,
  stored: ReadonlyArray<StoredOrderLine>,
): { ok: true; lines: StaffPricedLine[] } | { ok: false; error: string } {
  if (inputs.length < 1) return { ok: false, error: 'Thêm ít nhất một sản phẩm.' };
  if (inputs.length > STAFF_MAX_LINES) return { ok: false, error: `Một đơn tối đa ${STAFF_MAX_LINES} mẫu.` };
  const used = new Set<number>();
  const lines: StaffPricedLine[] = [];
  for (const [index, input] of inputs.entries()) {
    const quantity = readQuantity(input.quantity);
    if (quantity === null) return lineError(index, `Số lượng là số nguyên từ 1 đến ${ORDER_MAX_QUANTITY}.`);
    const productId = readProductId(input.productId);
    if (productId === 'bad') return lineError(index, 'Chọn sản phẩm đang bán.');
    const weight = input.weight.trim();
    if (weight.length > 40) return lineError(index, 'Cân nặng không hợp lệ.');
    const storedLine = takeStored(stored, input.slot, used);
    if (storedLine && storedLine.productId === productId && (storedLine.optionLabel ?? '') === weight) {
      const named = readLineName(input.name, storedLine.productName);
      if (!named.ok) return lineError(index, named.error);
      const unitPrice = readUnitPrice(input.price, storedLine.unitPrice);
      if (unitPrice === 'bad') return lineError(index, 'Đơn giá là số từ 0 đến 99.999.999.');
      const lineTotal = lineAmount(unitPrice, quantity);
      if (lineTotal === null) return lineError(index, 'Đơn giá không hợp lệ.');
      lines.push({
        productId: storedLine.productId,
        productName: named.name,
        unitPrice,
        quantity,
        optionLabel: storedLine.optionLabel,
        lineTotal,
      });
      continue;
    }
    if (productId === null) return lineError(index, 'Chọn sản phẩm đang bán.');
    const product = catalog.find((item) => item.id === productId);
    if (!product) return lineError(index, 'Chọn sản phẩm đang bán.');
    // Đơn nội bộ cho phép cân tùy chỉnh qua "Thêm cân"; thang none thì không nhận cân.
    if (requiresWeight(product.weightScale) && !weight) return lineError(index, 'Chọn cân nặng cho bé.');
    if (!requiresWeight(product.weightScale) && weight) return lineError(index, 'Cân nặng không hợp lệ.');
    const named = readLineName(input.name, product.name);
    if (!named.ok) return lineError(index, named.error);
    const unitPrice = readUnitPrice(input.price, product.price);
    if (unitPrice === 'bad') return lineError(index, 'Đơn giá là số từ 0 đến 99.999.999.');
    const lineTotal = lineAmount(unitPrice, quantity);
    if (lineTotal === null) return lineError(index, 'Đơn giá không hợp lệ.');
    lines.push({
      productId: product.id,
      productName: named.name,
      unitPrice,
      quantity,
      optionLabel: orderOptionLabel(weight),
      lineTotal,
    });
  }
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  if (subtotal > MONEY_MAX) return { ok: false, error: 'Tổng tiền quá lớn.' };
  return { ok: true, lines };
}

// Ô tổng để trống thì lấy tạm tính trừ mã và giảm thêm. Gõ tổng thì phần chênh sau mã là giảm thêm.
export function settleStaffTotal(
  subtotal: number,
  codeDiscount: number,
  rawTotal: string,
  rawExtra = '',
): { ok: true; totalPrice: number; discountAmount: number } | { ok: false; error: string } {
  const codePart = Math.min(Math.max(0, codeDiscount), subtotal);
  const room = subtotal - codePart;
  const totalText = rawTotal.trim().replace(/[.\s]/g, '');
  if (totalText) {
    if (!/^\d{1,9}$/.test(totalText)) return { ok: false, error: 'Tổng tiền là số từ 0 đến 999.999.999.' };
    const totalPrice = Number(totalText);
    if (!Number.isSafeInteger(totalPrice) || totalPrice > MONEY_MAX) return { ok: false, error: 'Tổng tiền quá lớn.' };
    if (totalPrice > subtotal) return { ok: false, error: 'Tổng tiền lớn hơn tạm tính. Hãy tăng đơn giá.' };
    if (totalPrice > room) return { ok: false, error: 'Tổng tiền lớn hơn số sau mã giảm giá.' };
    return { ok: true, totalPrice, discountAmount: subtotal - totalPrice };
  }
  const extraText = rawExtra.trim().replace(/[.\s]/g, '');
  if (extraText && !/^\d{1,8}$/.test(extraText)) return { ok: false, error: 'Giảm thêm là số từ 0 đến 99.999.999.' };
  const extra = extraText ? Number(extraText) : 0;
  if (!Number.isSafeInteger(extra) || extra < 0) return { ok: false, error: 'Giảm thêm là số từ 0 đến 99.999.999.' };
  const discountExtra = Math.min(extra, room);
  return { ok: true, totalPrice: room - discountExtra, discountAmount: codePart + discountExtra };
}

// Gửi bù thì không thu tiền và không giữ mã. Phí ship cộng sau giảm giá hàng. Miễn phí thì phí khách = 0.
export function applyStaffCollection(
  goodsPayable: number,
  discountAmount: number,
  discountCode: string | null,
  flags: { compensation: boolean; shippingFee: number },
): { ok: true; totalPrice: number; discountAmount: number; discountCode: string | null; shippingFee: number } | { ok: false; error: string } {
  if (flags.compensation) return { ok: true, totalPrice: 0, discountAmount: 0, discountCode: null, shippingFee: 0 };
  const fee = flags.shippingFee;
  if (!Number.isSafeInteger(goodsPayable) || !Number.isSafeInteger(fee) || goodsPayable < 0 || fee < 0) return { ok: false, error: 'Phí vận chuyển không hợp lệ.' };
  if (goodsPayable + fee > MONEY_MAX) return { ok: false, error: 'Tổng tiền quá lớn.' };
  return {
    ok: true,
    totalPrice: goodsPayable + fee,
    discountAmount,
    discountCode: discountAmount > 0 ? discountCode : null,
    shippingFee: fee,
  };
}

export function readStaffFlags(input: {
  payState: string;
  source: string;
  priority: string;
  compensation: string;
  shipLater: string;
  shipOn: string;
  shippingFee: string;
  freeShip: string;
}): { ok: true; flags: StaffFlags } | { ok: false; error: string } {
  const pay = PAY_STATES.find((item) => item.value === input.payState.trim());
  if (!pay) return { ok: false, error: 'Chọn hình thức thanh toán.' };
  const source = ORDER_SOURCES.find((item) => item.value === input.source.trim());
  if (!source) return { ok: false, error: 'Chọn nguồn khách.' };
  const shipLater = checked(input.shipLater);
  const shipOn = shipLater ? parseShipDay(input.shipOn) : null;
  if (shipLater && shipOn === null) return { ok: false, error: 'Chọn ngày dự kiến gửi.' };
  const compensation = checked(input.compensation);
  const freeShip = checked(input.freeShip);
  const shippingFee = compensation || freeShip ? 0 : readFee(input.shippingFee);
  if (shippingFee === 'bad') return { ok: false, error: 'Phí vận chuyển là số từ 0 đến 99.999.999.' };
  return {
    ok: true,
    flags: {
      source: source.value,
      payState: pay.value,
      paymentMethod: pay.paymentMethod,
      priority: checked(input.priority),
      compensation,
      shipOn,
      shippingFee,
    },
  };
}

export function staffFlagForm(order: {
  payState: string | null;
  paymentMethod: string;
  source: string | null;
  priority: number;
  compensation: number;
  shipOn: number | null;
  shippingFee: number;
  shippingCost: number;
}): StaffFlagForm {
  const payState = PAY_STATES.some((item) => item.value === order.payState)
    ? order.payState
    : order.paymentMethod === 'bank'
      ? 'paid'
      : 'cod';
  return {
    payState: payState ?? 'cod',
    source: order.source ?? '',
    priority: order.priority === 1,
    compensation: order.compensation === 1,
    shipLater: order.shipOn !== null,
    shipOn: order.shipOn === null ? '' : formatShipDay(order.shipOn),
    shippingFee: order.shippingFee > 0 ? String(order.shippingFee) : '',
    freeShip: order.shippingFee === 0 && order.shippingCost > 0,
  };
}

export function sourceLabel(value: string | null): string {
  return ORDER_SOURCES.find((item) => item.value === value)?.label ?? '';
}

export function collectionLabel(payState: string | null, paymentMethod: string): string {
  return PAY_STATES.find((item) => item.value === payState)?.label ?? paymentLabel(paymentMethod);
}

export function formatShipDay(timestamp: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp));
}

export function formatShipLabel(timestamp: number): string {
  return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit' }).format(new Date(timestamp));
}

export function capDiscount(subtotal: number, discountAmount: number): { discountAmount: number; totalPrice: number } {
  const discount = Math.min(Math.max(0, discountAmount), subtotal);
  return { discountAmount: discount, totalPrice: subtotal - discount };
}

// Một mẫu lưu trên đơn. Từ hai mẫu thì đơn chỉ giữ tên tóm tắt, chi tiết nằm ở order_items — cùng cách với giỏ hàng.
export function staffOrderColumns(lines: StaffPricedLine[]): {
  productId: number | null;
  productName: string;
  unitPrice: number;
  quantity: number;
  optionLabel: string | null;
  subtotal: number;
} {
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const line = lines[0];
  if (lines.length === 1 && line) {
    return {
      productId: line.productId,
      productName: line.productName,
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      optionLabel: line.optionLabel,
      subtotal,
    };
  }
  return {
    productId: null,
    productName: cartSummary(lines.map((item) => item.productName)),
    unitPrice: 0,
    quantity: lines.reduce((sum, item) => sum + item.quantity, 0),
    optionLabel: null,
    subtotal,
  };
}

export function orderLineSources(order: {
  productId: number | null;
  productName: string;
  unitPrice: number;
  quantity: number;
  optionLabel: string | null;
  subtotal: number | null;
  totalPrice: number;
  discountAmount: number;
  items: StoredOrderLine[];
}): StoredOrderLine[] {
  if (order.items.length > 0) return order.items;
  return [
    {
      productId: order.productId,
      productName: order.productName,
      unitPrice: order.unitPrice,
      quantity: order.quantity,
      optionLabel: order.optionLabel,
      lineTotal: order.subtotal ?? order.totalPrice + order.discountAmount,
    },
  ];
}

export function parseStaffCustomer(input: {
  customerName: string;
  phone: string;
  address: string;
  note: string;
  paymentMethod: string;
}): { ok: true; value: Omit<StaffOrderDraft, 'lines' | 'discountCode' | 'orderTotal' | 'flags'> } | { ok: false; errors: FieldErrors } {
  const customer = readCustomer(input);
  const errors: FieldErrors = { ...customer.errors };
  const paymentRaw = input.paymentMethod.trim();
  if (paymentRaw && !isPaymentMethod(paymentRaw)) errors.paymentMethod = 'Chọn hình thức thanh toán.';
  if (Object.keys(errors).length > 0 || !customer.phone) return { ok: false, errors };
  return {
    ok: true,
    value: {
      customerName: customer.customerName,
      phone: customer.phone,
      address: customer.address,
      note: customer.note,
      paymentMethod: isPaymentMethod(paymentRaw) ? paymentRaw : DEFAULT_PAYMENT_METHOD,
    },
  };
}

function texts(form: FormData, name: string): string[] {
  return form.getAll(name).map((value) => (typeof value === 'string' ? value : ''));
}

function readQuantity(value: string): number | null {
  const text = value.trim();
  if (!/^\d{1,2}$/.test(text)) return null;
  const quantity = Number(text);
  return quantity >= 1 && quantity <= ORDER_MAX_QUANTITY ? quantity : null;
}

function readProductId(value: string): number | null | 'bad' {
  const text = value.trim();
  if (!text) return null;
  if (!/^\d{1,9}$/.test(text)) return 'bad';
  const id = Number(text);
  return Number.isSafeInteger(id) && id > 0 ? id : 'bad';
}

function takeStored(stored: ReadonlyArray<StoredOrderLine>, slot: string, used: Set<number>): StoredOrderLine | undefined {
  if (!/^\d+$/.test(slot.trim())) return undefined;
  const index = Number(slot);
  if (used.has(index)) return undefined;
  const line = stored[index];
  if (!line) return undefined;
  used.add(index);
  return line;
}

function readUnitPrice(raw: string | undefined, fallback: number): number | 'bad' {
  const text = (raw ?? '').trim().replace(/[.\s]/g, '');
  if (!text) return fallback;
  if (!/^\d{1,8}$/.test(text)) return 'bad';
  const price = Number(text);
  return Number.isSafeInteger(price) ? price : 'bad';
}

function checked(value: string): boolean {
  return value === 'on' || value === '1';
}

function parseShipDay(value: string): number | null {
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const time = Date.parse(`${text}T00:00:00+07:00`);
  return Number.isFinite(time) ? time : null;
}

function readFee(raw: string): number | 'bad' {
  const text = raw.trim().replace(/[.\s]/g, '');
  if (!text) return 0;
  if (!/^\d{1,8}$/.test(text)) return 'bad';
  const fee = Number(text);
  return Number.isSafeInteger(fee) ? fee : 'bad';
}

function lineAmount(unitPrice: number, quantity: number): number | null {
  if (!Number.isSafeInteger(unitPrice) || unitPrice < 0 || unitPrice > 99_999_999) return null;
  const total = unitPrice * quantity;
  return Number.isSafeInteger(total) && total <= MONEY_MAX ? total : null;
}

function lineError(index: number, message: string): { ok: false; error: string } {
  return { ok: false, error: `Dòng ${index + 1}: ${message}` };
}
