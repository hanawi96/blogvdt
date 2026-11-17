import { and, asc, desc, eq, inArray, like, ne, sql } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { orderItems, orders, productCategories, products } from '../../lib/db/schema';
import { routes } from '../../lib/routes';
import { readWeightScale, weightChips, weightExtras, type WeightScale } from '../products/weight';
import { normalizePhone } from './order';
import { orderSearchTerm } from './orders';
import { canEditOrderProducts } from './staff';
import { FULFILL_STATUS_LABELS, fulfillStatusOf, orderStatusLabel } from './status';

const PAGE_SIZE = 20;
export const CUSTOMER_SORTS = [
  { value: 'recent', label: 'Mua gần nhất' },
  { value: 'orders', label: 'Nhiều đơn nhất' },
  { value: 'spent', label: 'Chi tiêu nhiều nhất' },
] as const;

export type CustomerSort = (typeof CUSTOMER_SORTS)[number]['value'];

/** Phân loại theo số đơn chưa hủy: 1 = mới, 2 = quen, ≥3 = VIP. */
export const CUSTOMER_TIERS = ['new', 'regular', 'vip'] as const;
export type CustomerTier = (typeof CUSTOMER_TIERS)[number];
export const CUSTOMER_TIER_LABELS: Record<CustomerTier, string> = {
  new: 'Mới',
  regular: 'Khách quen',
  vip: 'Khách VIP',
};

export function customerTierOf(orderCount: number): CustomerTier {
  if (orderCount >= 3) return 'vip';
  if (orderCount >= 2) return 'regular';
  return 'new';
}

export function customerSort(value: string | null | undefined): CustomerSort {
  return CUSTOMER_SORTS.find((sort) => sort.value === value)?.value ?? 'recent';
}

export function customerAdminQuery(input: { query?: string; sort?: string; page?: number }): string {
  const params = new URLSearchParams();
  const query = (input.query ?? '').replace(/[%_]/g, '').trim().slice(0, 80);
  const sort = customerSort(input.sort);
  const page = input.page && Number.isInteger(input.page) && input.page > 1 ? input.page : 0;
  if (query) params.set('q', query);
  if (sort !== 'recent') params.set('sort', sort);
  if (page) params.set('page', String(page));
  const text = params.toString();
  return text ? `${routes.adminCustomers}?${text}` : routes.adminCustomers;
}

/** Khách không có tài khoản: mỗi số điện thoại (đã chuẩn hóa khi đặt) là một khách. */
export async function listCustomers(db: AppDb, filters: { query: string; sort: CustomerSort; page: number }) {
  const term = orderSearchTerm(filters.query);
  const partialPhone = /^[\d\s.+\-()]+$/.test(term.text) ? term.text.replace(/\D/g, '') : '';
  const phone = term.phone || partialPhone;
  // Lọc theo tên bằng subquery để số đơn và tổng chi tiêu vẫn tính trên mọi đơn của số điện thoại đó.
  const where = phone
    ? like(orders.phone, `%${phone}%`)
    : term.text
      ? inArray(orders.phone, db.select({ phone: orders.phone }).from(orders).where(like(orders.customerName, `%${term.text}%`)))
      : undefined;
  const page = Math.max(1, filters.page);
  // Số đơn xếp hạng: không tính đơn hủy. Tổng đơn hiển thị vẫn dùng cùng số này để khớp cấp khách.
  const orderCount = sql<number>`coalesce(sum(case when ${orders.status} <> 'cancelled' then 1 else 0 end), 0)`;
  // SQLite lấy cột không gộp từ đúng dòng có max() khi truy vấn chỉ có một min()/max(): tên, địa chỉ là của đơn mới nhất.
  const lastOrderAt = sql<number>`max(${orders.createdAt})`;
  const spent = sql<number>`coalesce(sum(case when ${orders.status} <> 'cancelled' then ${orders.totalPrice} else 0 end), 0)`;
  const order =
    filters.sort === 'orders'
      ? [desc(orderCount), desc(lastOrderAt), asc(orders.phone)]
      : filters.sort === 'spent'
        ? [desc(spent), desc(lastOrderAt), asc(orders.phone)]
        : [desc(lastOrderAt), asc(orders.phone)];
  const distinctPhones = sql<number>`count(distinct ${orders.phone})`;
  const [rows, totalRows, libraryRows] = await db.batch([
    db
      .select({
        phone: orders.phone,
        customerName: orders.customerName,
        address: orders.address,
        orderCount,
        spent,
        lastOrderAt,
      })
      .from(orders)
      .where(where)
      .groupBy(orders.phone)
      .orderBy(...order)
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ value: distinctPhones }).from(orders).where(where),
    db.select({ value: distinctPhones }).from(orders),
  ]);
  const total = totalRows[0]?.value ?? 0;
  return {
    rows: rows.map((row) => ({ ...row, tier: customerTierOf(Number(row.orderCount) || 0) })),
    total,
    libraryTotal: libraryRows[0]?.value ?? 0,
    page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

export type CustomerLookupLine = {
  productId: number | null;
  productName: string;
  weight: string;
  quantity: number;
  note: string;
  weightScale: WeightScale;
  chips: string[];
  extras: string[];
};

export type CustomerPhoneLookup = {
  phone: string;
  customerName: string;
  address: string;
  /** Tỉnh/TP suy từ phần cuối địa chỉ ghép (hiển thị badge extension). */
  provinceLabel: string;
  orderCount: number;
  recent: {
    id: number;
    code: string;
    statusLabel: string;
    fulfillLabel: string;
    totalPrice: number;
    quantity: number;
    /** Cân nặng suy từ option (vd «3kg»), rỗng nếu không có. */
    weightLabel: string;
    productName: string;
    optionLabel: string | null;
    createdAt: number;
    editable: boolean;
    discountCode: string;
    shippingFee: number;
    lines: CustomerLookupLine[];
  } | null;
};

/** Lấy «3kg» từ nhãn option nếu có. */
function weightLabelFromOption(optionLabel: string | null | undefined): string {
  const raw = String(optionLabel || '');
  const match = raw.match(/(\d+(?:[.,]\d+)?)\s*kg\b/i);
  if (!match?.[1]) return '';
  return `${match[1].replace(',', '.')}kg`;
}

function linePayload(
  productId: number | null,
  productName: string,
  optionLabel: string | null | undefined,
  quantity: number,
  note: string | null | undefined,
  weightScaleRaw: unknown,
): CustomerLookupLine {
  const weightScale = readWeightScale(weightScaleRaw);
  return {
    productId,
    productName,
    weight: String(optionLabel || '').trim(),
    quantity: Math.max(1, Number(quantity) || 1),
    note: String(note || '').trim(),
    weightScale,
    chips: [...weightChips(weightScale)],
    extras: [...weightExtras(weightScale)],
  };
}

/** Dòng SP của đơn gần nhất: ưu tiên order_items, fallback header đơn cũ. */
async function lookupRecentLines(
  db: AppDb,
  order: {
    id: number;
    productId: number | null;
    productName: string;
    quantity: number;
    optionLabel: string | null;
  },
): Promise<CustomerLookupLine[]> {
  const itemRows = await db
    .select({
      productId: orderItems.productId,
      productName: orderItems.productName,
      quantity: orderItems.quantity,
      optionLabel: orderItems.optionLabel,
      note: orderItems.note,
      weightScale: productCategories.weightScale,
    })
    .from(orderItems)
    .leftJoin(products, eq(orderItems.productId, products.id))
    .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
    .where(eq(orderItems.orderId, order.id))
    .orderBy(asc(orderItems.sortOrder), asc(orderItems.id));
  if (itemRows.length > 0) {
    return itemRows.map((row) =>
      linePayload(row.productId, row.productName, row.optionLabel, row.quantity, row.note, row.weightScale),
    );
  }
  let weightScaleRaw: unknown = 'baby';
  if (order.productId != null) {
    const scaleRows = await db
      .select({ weightScale: productCategories.weightScale })
      .from(products)
      .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
      .where(eq(products.id, order.productId))
      .limit(1);
    weightScaleRaw = scaleRows[0]?.weightScale;
  }
  return [
    linePayload(order.productId, order.productName, order.optionLabel, order.quantity, null, weightScaleRaw),
  ];
}

/** Tra khách theo SĐT cho POS / extension: đơn gần nhất + số đơn chưa hủy. */
export async function lookupCustomerByPhone(db: AppDb, rawPhone: string): Promise<CustomerPhoneLookup | null> {
  const phone = normalizePhone(rawPhone) ?? (/^\d{8,11}$/.test(rawPhone.replace(/\D/g, '')) ? rawPhone.replace(/\D/g, '') : null);
  if (!phone) return null;
  const recentRows = await db
    .select({
      id: orders.id,
      code: orders.code,
      customerName: orders.customerName,
      phone: orders.phone,
      address: orders.address,
      status: orders.status,
      fulfillStatus: orders.fulfillStatus,
      totalPrice: orders.totalPrice,
      quantity: orders.quantity,
      productId: orders.productId,
      productName: orders.productName,
      optionLabel: orders.optionLabel,
      discountCode: orders.discountCode,
      shippingFee: orders.shippingFee,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(eq(orders.phone, phone))
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(1);
  const recent = recentRows[0];
  if (!recent) return null;
  const countRows = await db
    .select({ value: sql<number>`count(*)` })
    .from(orders)
    .where(and(eq(orders.phone, phone), ne(orders.status, 'cancelled')));
  const fulfill = fulfillStatusOf(recent);
  const fulfillLabel = fulfill ? FULFILL_STATUS_LABELS[fulfill] : orderStatusLabel(recent.status);
  const parts = recent.address.split(',').map((part) => part.trim()).filter(Boolean);
  const provinceLabel = parts.length > 0 ? parts[parts.length - 1]! : '';
  const lines = await lookupRecentLines(db, recent);
  const first = lines[0];
  return {
    phone: recent.phone,
    customerName: recent.customerName,
    address: recent.address,
    provinceLabel,
    orderCount: Number(countRows[0]?.value ?? 0),
    recent: {
      id: recent.id,
      code: recent.code,
      statusLabel: orderStatusLabel(recent.status),
      fulfillLabel,
      totalPrice: recent.totalPrice,
      quantity: lines.reduce((sum, line) => sum + line.quantity, 0) || Number(recent.quantity) || 1,
      weightLabel: first ? weightLabelFromOption(first.weight) || first.weight : weightLabelFromOption(recent.optionLabel),
      productName: first?.productName || recent.productName,
      optionLabel: first?.weight || recent.optionLabel,
      createdAt: recent.createdAt,
      editable: canEditOrderProducts(recent.status),
      discountCode: recent.discountCode || '',
      shippingFee: Math.max(0, Number(recent.shippingFee) || 0),
      lines,
    },
  };
}
