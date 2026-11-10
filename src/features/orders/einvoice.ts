import { and, asc, count, desc, eq, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { vnAddDays, vnTodayParts, vnYmd } from '../../lib/datetime';
import type { AppDb } from '../../lib/db/client';
import { orderItems, orders } from '../../lib/db/schema';

/** Số ngày chờ sau khi gửi trước khi đủ điều kiện xuất HĐĐT. */
export const INVOICE_WAIT_DAYS = 10;

export const INVOICE_PAGE_SIZE = 30;
export const INVOICE_EXPORT_MAX = 100;

export const INVOICE_TABS = ['ready', 'waiting', 'done'] as const;
export type InvoiceTab = (typeof INVOICE_TABS)[number];

export function isInvoiceTab(value: string | null | undefined): value is InvoiceTab {
  return value === 'ready' || value === 'waiting' || value === 'done';
}

export function parseInvoiceTab(value: string | null | undefined): InvoiceTab {
  return isInvoiceTab(value) ? value : 'ready';
}

/** Mốc exclusive: shipped_at < mốc này ⇒ đã đủ INVOICE_WAIT_DAYS theo lịch VN. */
export function invoiceEligibleBeforeMs(now = Date.now()): number {
  const day = vnAddDays(vnTodayParts(now), -(INVOICE_WAIT_DAYS - 1));
  return Date.parse(`${vnYmd(day)}T00:00:00+07:00`);
}

export function invoiceCalendarDaysSinceShipped(shippedAt: number, now = Date.now()): number {
  const ship = vnTodayParts(shippedAt);
  const today = vnTodayParts(now);
  const a = Date.UTC(ship.year, ship.month - 1, ship.day);
  const b = Date.UTC(today.year, today.month - 1, today.day);
  return Math.floor((b - a) / 86_400_000);
}

export function invoiceDaysRemaining(shippedAt: number, now = Date.now()): number {
  return Math.max(0, INVOICE_WAIT_DAYS - invoiceCalendarDaysSinceShipped(shippedAt, now));
}

export function isInvoiceDateEligible(shippedAt: number, now = Date.now()): boolean {
  return invoiceDaysRemaining(shippedAt, now) === 0;
}

const shippedCondition = or(
  eq(orders.fulfillStatus, 'shipped'),
  and(isNull(orders.fulfillStatus), eq(orders.status, 'shipped')),
);

function baseShippedOpen() {
  return and(shippedCondition, ne(orders.status, 'cancelled'), eq(orders.compensation, 0), isNotNull(orders.shippedAt));
}

export type InvoiceListItem = {
  id: number;
  code: string;
  customerName: string;
  phone: string;
  totalPrice: number;
  paymentMethod: string;
  shippedAt: number;
  invoiceExportedAt: number | null;
  itemCount: number;
  daysRemaining: number;
};

export type InvoiceListResult = {
  tab: InvoiceTab;
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
  items: InvoiceListItem[];
  counts: { ready: number; waiting: number; done: number };
};

function tabWhere(tab: InvoiceTab, now: number) {
  const eligibleBefore = invoiceEligibleBeforeMs(now);
  const base = baseShippedOpen();
  if (tab === 'done') {
    return and(isNotNull(orders.invoiceExportedAt));
  }
  if (tab === 'waiting') {
    return and(base, isNull(orders.invoiceExportedAt), sql`${orders.shippedAt} >= ${eligibleBefore}`);
  }
  return and(base, isNull(orders.invoiceExportedAt), lt(orders.shippedAt, eligibleBefore));
}

export async function listInvoiceOrders(
  db: AppDb,
  input: { tab?: InvoiceTab; page?: number; now?: number } = {},
): Promise<InvoiceListResult> {
  const tab = input.tab ?? 'ready';
  const now = input.now ?? Date.now();
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const where = tabWhere(tab, now);

  const orderBy =
    tab === 'done'
      ? [desc(orders.invoiceExportedAt), desc(orders.id)]
      : tab === 'waiting'
        ? [asc(orders.shippedAt), asc(orders.id)]
        : [asc(orders.shippedAt), asc(orders.id)];

  const [totalRow, readyRow, waitingRow, doneRow, rows] = await Promise.all([
    db.select({ value: count() }).from(orders).where(where),
    db.select({ value: count() }).from(orders).where(tabWhere('ready', now)),
    db.select({ value: count() }).from(orders).where(tabWhere('waiting', now)),
    db.select({ value: count() }).from(orders).where(tabWhere('done', now)),
    db
      .select({
        id: orders.id,
        code: orders.code,
        customerName: orders.customerName,
        phone: orders.phone,
        totalPrice: orders.totalPrice,
        paymentMethod: orders.paymentMethod,
        shippedAt: orders.shippedAt,
        invoiceExportedAt: orders.invoiceExportedAt,
      })
      .from(orders)
      .where(where)
      .orderBy(...orderBy)
      .limit(INVOICE_PAGE_SIZE)
      .offset((page - 1) * INVOICE_PAGE_SIZE),
  ]);

  const total = totalRow[0]?.value ?? 0;
  const ids = rows.map((row) => row.id);
  const itemCounts = new Map<number, number>();
  if (ids.length > 0) {
    const counted = await db
      .select({ orderId: orderItems.orderId, value: count() })
      .from(orderItems)
      .where(inArray(orderItems.orderId, ids))
      .groupBy(orderItems.orderId);
    for (const row of counted) itemCounts.set(row.orderId, row.value);
  }

  return {
    tab,
    page,
    pageSize: INVOICE_PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / INVOICE_PAGE_SIZE)),
    total,
    counts: {
      ready: readyRow[0]?.value ?? 0,
      waiting: waitingRow[0]?.value ?? 0,
      done: doneRow[0]?.value ?? 0,
    },
    items: rows.map((row) => {
      const shippedAt = row.shippedAt ?? 0;
      const lines = itemCounts.get(row.id) ?? 0;
      return {
        id: row.id,
        code: row.code,
        customerName: row.customerName,
        phone: row.phone,
        totalPrice: row.totalPrice,
        paymentMethod: row.paymentMethod,
        shippedAt,
        invoiceExportedAt: row.invoiceExportedAt,
        itemCount: lines > 0 ? lines : 1,
        daysRemaining: invoiceDaysRemaining(shippedAt, now),
      };
    }),
  };
}

export type InvoiceExportLine = {
  productId: number | null;
  productName: string;
  optionLabel: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
};

export type InvoiceExportOrder = {
  id: number;
  code: string;
  customerName: string;
  address: string;
  paymentMethod: string;
  productId: number | null;
  productName: string;
  optionLabel: string | null;
  unitPrice: number;
  quantity: number;
  lines: InvoiceExportLine[];
};

export async function loadOrdersForInvoiceExport(db: AppDb, ids: number[]): Promise<InvoiceExportOrder[]> {
  const unique = [...new Set(ids)].filter((id) => Number.isInteger(id) && id > 0);
  if (unique.length === 0) return [];

  const rows = await db
    .select({
      id: orders.id,
      code: orders.code,
      customerName: orders.customerName,
      address: orders.address,
      paymentMethod: orders.paymentMethod,
      productId: orders.productId,
      productName: orders.productName,
      optionLabel: orders.optionLabel,
      unitPrice: orders.unitPrice,
      quantity: orders.quantity,
    })
    .from(orders)
    .where(inArray(orders.id, unique));

  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = unique.map((id) => byId.get(id)).filter((row): row is NonNullable<typeof row> => row != null);
  if (ordered.length === 0) return [];

  const itemRows = await db
    .select({
      orderId: orderItems.orderId,
      productId: orderItems.productId,
      productName: orderItems.productName,
      optionLabel: orderItems.optionLabel,
      unitPrice: orderItems.unitPrice,
      quantity: orderItems.quantity,
      lineTotal: orderItems.lineTotal,
      sortOrder: orderItems.sortOrder,
      id: orderItems.id,
    })
    .from(orderItems)
    .where(inArray(orderItems.orderId, ordered.map((row) => row.id)))
    .orderBy(asc(orderItems.sortOrder), asc(orderItems.id));

  const linesByOrder = new Map<number, InvoiceExportLine[]>();
  for (const item of itemRows) {
    const list = linesByOrder.get(item.orderId) ?? [];
    list.push({
      productId: item.productId,
      productName: item.productName,
      optionLabel: item.optionLabel,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      lineTotal: item.lineTotal,
    });
    linesByOrder.set(item.orderId, list);
  }

  return ordered.map((row) => ({
    id: row.id,
    code: row.code,
    customerName: row.customerName,
    address: row.address,
    paymentMethod: row.paymentMethod,
    productId: row.productId,
    productName: row.productName,
    optionLabel: row.optionLabel,
    unitPrice: row.unitPrice,
    quantity: row.quantity,
    lines: linesByOrder.get(row.id) ?? [],
  }));
}

/** Lọc id đủ điều kiện xuất lần đầu (ready). */
export async function filterReadyInvoiceIds(db: AppDb, ids: number[], now = Date.now()): Promise<number[]> {
  const unique = [...new Set(ids)].filter((id) => Number.isInteger(id) && id > 0).slice(0, INVOICE_EXPORT_MAX);
  if (unique.length === 0) return [];
  const rows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(inArray(orders.id, unique), tabWhere('ready', now)));
  const allowed = new Set(rows.map((row) => row.id));
  return unique.filter((id) => allowed.has(id));
}

/** Lọc id đã xuất để xuất lại file. */
export async function filterDoneInvoiceIds(db: AppDb, ids: number[]): Promise<number[]> {
  const unique = [...new Set(ids)].filter((id) => Number.isInteger(id) && id > 0).slice(0, INVOICE_EXPORT_MAX);
  if (unique.length === 0) return [];
  const rows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(inArray(orders.id, unique), isNotNull(orders.invoiceExportedAt)));
  const allowed = new Set(rows.map((row) => row.id));
  return unique.filter((id) => allowed.has(id));
}

/** Chỉ ghi mốc đã xuất; activity do luồng tải file ghi. */
export async function markOrdersInvoiceExported(db: AppDb, ids: number[], now = Date.now()): Promise<number> {
  const unique = [...new Set(ids)].filter((id) => Number.isInteger(id) && id > 0);
  if (unique.length === 0) return 0;
  await db
    .update(orders)
    .set({ invoiceExportedAt: now, updatedAt: now })
    .where(and(inArray(orders.id, unique), isNull(orders.invoiceExportedAt)));
  return unique.length;
}
