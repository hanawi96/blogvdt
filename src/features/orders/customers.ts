import { and, asc, count, desc, eq, isNotNull, isNull, like, ne, or, sql } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { customers, orderItems, orders, productCategories, products } from '../../lib/db/schema';
import type { FieldErrors } from '../../lib/validation/errors';
import { routes } from '../../lib/routes';
import { activityWrite, commitWrites, type ActivityActor } from '../activity/log';
import { readWeightScale, weightChips, weightExtras, type WeightScale } from '../products/weight';
import { isUniqueViolation, normalizePhone, orderSearchTerm, readCustomer } from './order';
import { canEditOrderProducts } from './staff';
import { FULFILL_STATUS_LABELS, fulfillStatusOf, orderShippedBadgeLabel, orderStatusLabel } from './status';

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

export function customerAdminQuery(input: {
  query?: string;
  sort?: string;
  page?: number;
  hidden?: boolean;
}): string {
  const params = new URLSearchParams();
  const query = (input.query ?? '').replace(/[%_]/g, '').trim().slice(0, 80);
  const sort = customerSort(input.sort);
  const page = input.page && Number.isInteger(input.page) && input.page > 1 ? input.page : 0;
  if (query) params.set('q', query);
  if (sort !== 'recent') params.set('sort', sort);
  if (input.hidden) params.set('hidden', '1');
  if (page) params.set('page', String(page));
  const text = params.toString();
  return text ? `${routes.adminCustomers}?${text}` : routes.adminCustomers;
}

/** Tạo hoặc cập nhật hồ sơ theo SĐT; trả về customer id để gắn đơn. */
export async function upsertCustomer(
  db: AppDb,
  input: { phone: string; name: string; address: string },
  now = Date.now(),
): Promise<number> {
  const existing = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.phone, input.phone))
    .limit(1);
  if (existing[0]) {
    await db
      .update(customers)
      .set({ name: input.name, address: input.address, updatedAt: now })
      .where(eq(customers.id, existing[0].id));
    return existing[0].id;
  }
  try {
    const inserted = await db
      .insert(customers)
      .values({
        phone: input.phone,
        name: input.name,
        address: input.address,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: customers.id });
    const id = inserted[0]?.id;
    if (id == null) throw new Error('customer_insert_empty');
    return id;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.phone, input.phone))
      .limit(1);
    const id = raced[0]?.id;
    if (id == null) throw error;
    await db
      .update(customers)
      .set({ name: input.name, address: input.address, updatedAt: now })
      .where(eq(customers.id, id));
    return id;
  }
}

export async function updateCustomerProfile(
  db: AppDb,
  id: number,
  input: { customerName: string; phone: string; address: string },
  actor: ActivityActor,
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; error: string; errors?: FieldErrors }> {
  const current = await db
    .select({
      id: customers.id,
      phone: customers.phone,
      name: customers.name,
      address: customers.address,
    })
    .from(customers)
    .where(eq(customers.id, id))
    .limit(1);
  const row = current[0];
  if (!row) return { ok: false, error: 'Không tìm thấy khách hàng.' };
  const parsed = readCustomer({ ...input, note: '' });
  if (Object.keys(parsed.errors).length > 0 || !parsed.phone) {
    return { ok: false, error: 'Thông tin khách chưa hợp lệ.', errors: parsed.errors };
  }
  if (parsed.phone !== row.phone) {
    const clash = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.phone, parsed.phone), ne(customers.id, id)))
      .limit(1);
    if (clash[0]) return { ok: false, error: 'Số điện thoại đã thuộc khách khác.' };
  }
  const changed =
    parsed.phone !== row.phone || parsed.customerName !== row.name || parsed.address !== row.address;
  if (!changed) return { ok: true };
  try {
    await commitWrites(db, [
      db
        .update(customers)
        .set({
          phone: parsed.phone,
          name: parsed.customerName,
          address: parsed.address,
          updatedAt: now,
        })
        .where(eq(customers.id, id)),
      activityWrite(
        db,
        {
          actorId: actor.id,
          actorName: actor.name,
          action: 'customer.update',
          objectType: 'customer',
          objectId: String(id),
          summary: `Sửa khách ${parsed.customerName} (${parsed.phone})`,
          createdAt: now,
        },
        true,
      ),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: 'Số điện thoại đã thuộc khách khác.' };
    throw error;
  }
  return { ok: true };
}

export async function hideCustomer(
  db: AppDb,
  id: number,
  actor: ActivityActor,
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const current = await db
    .select({ id: customers.id, name: customers.name, phone: customers.phone, hiddenAt: customers.hiddenAt })
    .from(customers)
    .where(eq(customers.id, id))
    .limit(1);
  const row = current[0];
  if (!row) return { ok: false, error: 'Không tìm thấy khách hàng.' };
  if (row.hiddenAt != null) return { ok: true };
  await commitWrites(db, [
    db.update(customers).set({ hiddenAt: now, updatedAt: now }).where(eq(customers.id, id)),
    activityWrite(
      db,
      {
        actorId: actor.id,
        actorName: actor.name,
        action: 'customer.hide',
        objectType: 'customer',
        objectId: String(id),
        summary: `Ẩn khách ${row.name} (${row.phone})`,
        createdAt: now,
      },
      true,
    ),
  ]);
  return { ok: true };
}

export async function restoreCustomer(
  db: AppDb,
  id: number,
  actor: ActivityActor,
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const current = await db
    .select({ id: customers.id, name: customers.name, phone: customers.phone, hiddenAt: customers.hiddenAt })
    .from(customers)
    .where(eq(customers.id, id))
    .limit(1);
  const row = current[0];
  if (!row) return { ok: false, error: 'Không tìm thấy khách hàng.' };
  if (row.hiddenAt == null) return { ok: true };
  await commitWrites(db, [
    db.update(customers).set({ hiddenAt: null, updatedAt: now }).where(eq(customers.id, id)),
    activityWrite(
      db,
      {
        actorId: actor.id,
        actorName: actor.name,
        action: 'customer.restore',
        objectType: 'customer',
        objectId: String(id),
        summary: `Khôi phục khách ${row.name} (${row.phone})`,
        createdAt: now,
      },
      true,
    ),
  ]);
  return { ok: true };
}

/** Danh sách từ bảng customers; số đơn / chi tiêu gộp theo customer_id. */
export async function listCustomers(
  db: AppDb,
  filters: { query: string; sort: CustomerSort; page: number; hidden?: boolean },
) {
  const term = orderSearchTerm(filters.query);
  const partialPhone = /^[\d\s.+\-()]+$/.test(term.text) ? term.text.replace(/\D/g, '') : '';
  const phone = term.phone || partialPhone;
  const visibility = filters.hidden ? isNotNull(customers.hiddenAt) : isNull(customers.hiddenAt);
  const search = phone
    ? like(customers.phone, `%${phone}%`)
    : term.text
      ? or(like(customers.name, `%${term.text}%`), like(customers.phone, `%${term.text}%`))
      : undefined;
  const where = and(visibility, search);
  const page = Math.max(1, filters.page);
  const orderCount = sql<number>`coalesce(sum(case when ${orders.status} <> 'cancelled' then 1 else 0 end), 0)`;
  const lastOrderAt = sql<number | null>`max(${orders.createdAt})`;
  const spent = sql<number>`coalesce(sum(case when ${orders.status} <> 'cancelled' then ${orders.totalPrice} else 0 end), 0)`;
  const orderBy =
    filters.sort === 'orders'
      ? [desc(orderCount), desc(lastOrderAt), asc(customers.phone)]
      : filters.sort === 'spent'
        ? [desc(spent), desc(lastOrderAt), asc(customers.phone)]
        : [desc(lastOrderAt), asc(customers.phone)];
  const activeWhere = isNull(customers.hiddenAt);
  const [rows, totalRows, libraryRows] = await db.batch([
    db
      .select({
        id: customers.id,
        phone: customers.phone,
        customerName: customers.name,
        address: customers.address,
        orderCount,
        spent,
        lastOrderAt,
      })
      .from(customers)
      .leftJoin(orders, eq(orders.customerId, customers.id))
      .where(where)
      .groupBy(customers.id)
      .orderBy(...orderBy)
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ value: count() }).from(customers).where(where),
    db.select({ value: count() }).from(customers).where(activeWhere),
  ]);
  const total = totalRows[0]?.value ?? 0;
  return {
    rows: rows.map((row) => ({
      ...row,
      lastOrderAt: row.lastOrderAt ?? 0,
      tier: customerTierOf(Number(row.orderCount) || 0),
    })),
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
    /** Mốc gửi hàng (ms); null nếu chưa gửi. */
    shippedAt: number | null;
    editable: boolean;
    /** unshipped | shipped | reship — dùng ẩn sửa/ưu tiên khi đã gửi hàng. */
    fulfillStatus: string | null;
    priority: boolean;
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

/** Tra khách theo SĐT cho POS / extension: hồ sơ customers + đơn gần nhất. */
export async function lookupCustomerByPhone(db: AppDb, rawPhone: string): Promise<CustomerPhoneLookup | null> {
  const phone = normalizePhone(rawPhone) ?? (/^\d{8,11}$/.test(rawPhone.replace(/\D/g, '')) ? rawPhone.replace(/\D/g, '') : null);
  if (!phone) return null;
  const profileRows = await db
    .select({
      id: customers.id,
      phone: customers.phone,
      name: customers.name,
      address: customers.address,
    })
    .from(customers)
    .where(eq(customers.phone, phone))
    .limit(1);
  const profile = profileRows[0];
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
      priority: orders.priority,
      createdAt: orders.createdAt,
      shippedAt: orders.shippedAt,
    })
    .from(orders)
    .where(profile ? eq(orders.customerId, profile.id) : eq(orders.phone, phone))
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(1);
  const recent = recentRows[0];
  if (!profile && !recent) return null;
  const countWhere = profile
    ? and(eq(orders.customerId, profile.id), ne(orders.status, 'cancelled'))
    : and(eq(orders.phone, phone), ne(orders.status, 'cancelled'));
  const countRows = await db.select({ value: sql<number>`count(*)` }).from(orders).where(countWhere);
  const customerName = profile?.name ?? recent?.customerName ?? '';
  const address = profile?.address ?? recent?.address ?? '';
  const displayPhone = profile?.phone ?? recent?.phone ?? phone;
  const fulfill = recent ? fulfillStatusOf(recent) : null;
  const fulfillLabel = recent
    ? fulfill === 'shipped'
      ? orderShippedBadgeLabel(recent.shippedAt)
      : fulfill
        ? FULFILL_STATUS_LABELS[fulfill]
        : orderStatusLabel(recent.status)
    : '';
  const parts = address.split(',').map((part) => part.trim()).filter(Boolean);
  const provinceLabel = parts.length > 0 ? parts[parts.length - 1]! : '';
  const lines = recent ? await lookupRecentLines(db, recent) : [];
  const first = lines[0];
  return {
    phone: displayPhone,
    customerName,
    address,
    provinceLabel,
    orderCount: Number(countRows[0]?.value ?? 0),
    recent: recent
      ? {
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
          shippedAt: recent.shippedAt ?? null,
          editable: canEditOrderProducts(recent.status),
          fulfillStatus: fulfill,
          priority: Number(recent.priority) === 1,
          discountCode: recent.discountCode || '',
          shippingFee: Math.max(0, Number(recent.shippingFee) || 0),
          lines,
        }
      : null,
  };
}
