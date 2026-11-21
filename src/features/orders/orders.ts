import { and, asc, count, desc, eq, gte, gt, inArray, isNull, like, lt, lte, ne, notInArray, or, sql } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { vnTodayParts, vnTodayStartMs, vnYmd } from '../../lib/datetime';
import { routes } from '../../lib/routes';
import { orderItems, orders, productCategories, products } from '../../lib/db/schema';
import { activityWrite, commitWrites, type ActivityActor } from '../activity/log';
import { claimDiscount, quoteStaffDiscount, releaseDiscount, restoreDiscountQuery } from '../discounts/discounts';
import { normalizeDiscountCode } from '../discounts/quote';
import { resolveProvinceCode } from '../address/provinces';
import { encodeCostLines, listOrderCosts, snapshotOrderCosts } from '../costs/order-costs';
import { baseCustomerShippingFee, resolveCustomerShippingFee, shipGroupOf } from '../shipping/customer-fee';
import { clearChatPhonePendingByPhone, refreshChatPhonePendingByPhone } from './chat-phone';
import { upsertCustomer } from './customers';
import {
  formatOrderCode,
  isRecentDuplicate,
  isUniqueViolation,
  normalizePhone,
  ORDER_IP_LIMIT,
  ORDER_IP_WINDOW_MS,
  orderDayKey,
  orderSearchTerm,
  readCustomer,
  sequenceFromCode,
  type CartOrderDraft,
  type OrderDraft,
} from './order';

export { orderSearchTerm };
import type { FieldErrors } from '../../lib/validation/errors';
import { isPaymentMethod, type PaymentMethod } from './payment';
import {
  applyStaffCollection,
  canEditOrderProducts,
  capDiscount,
  isOrderSource,
  orderLineSources,
  settleStaffTotal,
  staffOrderColumns,
  validateOrderDeposit,
  type OrderSource,
  type StaffFlags,
  type StaffOrderDraft,
} from './staff';
import {
  canTransitionOrder,
  isFulfillStatus,
  isOrderListFilter,
  isOrderStatus,
  orderTransitionError,
  type FulfillStatus,
  type OrderListFilter,
  type OrderStatus,
} from './status';

const PAGE_SIZE = 20;
/** Cho phép chọn qua nhiều trang (mỗi trang 20). */
export const ORDER_BULK_MAX = 100;
export const ORDER_BULK_ACTIONS = ['delete', 'export'] as const;
export type OrderBulkAction = (typeof ORDER_BULK_ACTIONS)[number];

type OrderListLine = {
  productName: string;
  quantity: number;
  optionLabel: string | null;
  unitPrice: number;
  note: string | null;
};

/** Lọc list theo giao hàng. `processing` giữ cho link dashboard cũ. `''` = tất cả (`status=all`). */
export type OrderListStatus = OrderListFilter | 'processing';

/** Hướng sắp xếp theo ngày đặt. `oldest` = đặt sớm nhất lên đầu (mặc định, hàng đợi xử lý). */
export type OrderSort = 'oldest' | 'newest';

export function orderListSort(value: string | null | undefined): OrderSort {
  return value === 'newest' ? 'newest' : 'oldest';
}

/**
 * Trạng thái list.
 * Không tìm → mặc định «Chưa gửi hàng». Có ô tìm và không chỉ định status → «Tất cả»
 * (tránh sót đơn đã gửi khi tra SĐT/mã). `status` tường minh trên URL vẫn được tôn trọng.
 */
export function orderListStatus(value: string | null | undefined, query?: string): OrderListStatus {
  if (value === 'processing') return 'processing';
  if (value === 'all' || value === '') return '';
  if (value && isOrderListFilter(value)) return value;
  if (query !== undefined) {
    const term = orderSearchTerm(query);
    if (term.phone || term.text) return '';
  }
  return 'unshipped';
}

/** Lọc list theo nguồn khách; `''` = tất cả. */
export function orderListSource(value: string | null | undefined): OrderSource | '' {
  return value && isOrderSource(value) ? value : '';
}

/** Lọc list theo hình thức thanh toán (COD / chuyển khoản); `''` = tất cả. */
export function orderListPayment(value: string | null | undefined): PaymentMethod | '' {
  return value && isPaymentMethod(value) ? value : '';
}

/** Bộ lọc nhanh thẻ tên trên list đơn. */
export const ORDER_TAG_THE_TEN = 'the-ten' as const;
export type OrderListTag = typeof ORDER_TAG_THE_TEN | '';

/** Chuỗi khớp bộ lọc thẻ tên (tên SP / lưu ý). */
export const ORDER_TAG_THE_TEN_MATCH = {
  productName: 'thẻ tên',
  note: 'thẻ',
} as const;

export function orderListTag(value: string | null | undefined): OrderListTag {
  return value === ORDER_TAG_THE_TEN ? ORDER_TAG_THE_TEN : '';
}

/** Kiểm tra đơn có khớp bộ lọc thẻ tên không (dùng cho test / logic thuần). */
export function orderMatchesTheTenTag(input: {
  productName: string;
  note: string | null;
  items: ReadonlyArray<{ productName: string; note: string | null }>;
}): boolean {
  const nameHit = (name: string) => name.toLowerCase().includes(ORDER_TAG_THE_TEN_MATCH.productName);
  const noteHit = (note: string | null) => (note ?? '').toLowerCase().includes(ORDER_TAG_THE_TEN_MATCH.note);
  if (nameHit(input.productName) || noteHit(input.note)) return true;
  return input.items.some((item) => nameHit(item.productName) || noteHit(item.note));
}

/**
 * Khớp thẻ tên trên SQL (tên SP «thẻ tên» / lưu ý đơn hoặc dòng SP có «thẻ»).
 * Dùng chung cho WHERE bộ lọc và ORDER BY ưu tiên thứ 2.
 */
function orderTheTenMatchSql() {
  const nameLike = `%${ORDER_TAG_THE_TEN_MATCH.productName}%`;
  const noteLike = `%${ORDER_TAG_THE_TEN_MATCH.note}%`;
  return sql`(
    ${orders.productName} like ${nameLike}
    or ifnull(${orders.note}, '') like ${noteLike}
    or exists (
      select 1 from order_items as oi
      where oi.order_id = ${orders.id}
        and (
          oi.product_name like ${nameLike}
          or ifnull(oi.note, '') like ${noteLike}
        )
    )
  )`;
}

/** Có ô tìm → luôn đơn mới nhất trước; tab đã gửi theo ngày gửi; còn lại: ưu tiên → thẻ tên → ngày đặt. */
function orderListOrderBy(filters: OrderListFilters) {
  const term = orderSearchTerm(filters.query);
  if (term.phone || term.text) return [desc(orders.createdAt), desc(orders.id)] as const;
  if (filters.status === 'shipped') return [desc(orders.shippedAt), desc(orders.id)] as const;
  const theTenBoost = sql`case when ${orderTheTenMatchSql()} then 1 else 0 end`;
  if (filters.sort === 'newest') {
    return [desc(orders.priority), desc(theTenBoost), desc(orders.createdAt), desc(orders.id)] as const;
  }
  return [desc(orders.priority), desc(theTenBoost), asc(orders.createdAt), asc(orders.id)] as const;
}

export function orderAdminQuery(input: {
  query?: string;
  status?: string;
  source?: string;
  payment?: string;
  from?: string;
  to?: string;
  tag?: string;
  sort?: string;
  page?: number;
  notice?: string;
  n?: number;
}): string {
  const params = new URLSearchParams();
  const query = (input.query ?? '').replace(/[%_]/g, '').trim().slice(0, 80);
  const status = orderListStatus(input.status);
  const source = orderListSource(input.source);
  const payment = orderListPayment(input.payment);
  const from = dayParam(input.from);
  const to = dayParam(input.to);
  const tag = orderListTag(input.tag);
  const sort = orderListSort(input.sort);
  const page = input.page && Number.isInteger(input.page) && input.page > 1 ? input.page : 0;
  const notice = (input.notice ?? '').trim();
  const count = input.n && Number.isInteger(input.n) && input.n > 0 ? input.n : 0;
  if (query) params.set('q', query);
  if (status === '') params.set('status', 'all');
  else if (status && status !== 'unshipped') params.set('status', status);
  if (source) params.set('source', source);
  if (payment) params.set('payment', payment);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (tag) params.set('tag', tag);
  if (sort === 'newest') params.set('sort', 'newest');
  if (page) params.set('page', String(page));
  if (notice) params.set('notice', notice);
  if (count) params.set('n', String(count));
  const text = params.toString();
  return text ? `${routes.adminOrders}?${text}` : routes.adminOrders;
}

/** URL fragment panel cho soft-nav / prefetch (cùng query với list). */
export function orderPanelQuery(input: {
  query?: string;
  status?: string;
  source?: string;
  payment?: string;
  from?: string;
  to?: string;
  tag?: string;
  sort?: string;
  page?: number;
}): string {
  const href = orderAdminQuery(input);
  return href.replace(routes.adminOrders, routes.adminOrdersPanel);
}

export function readOrderBulk(form: FormData): { action: OrderBulkAction; ids: number[] } | null {
  const action = ORDER_BULK_ACTIONS.find((item) => item === form.get('bulk'));
  const ids = [...new Set(form.getAll('ids').map(Number))].filter((id) => Number.isInteger(id) && id > 0);
  if (!action || ids.length === 0 || ids.length > ORDER_BULK_MAX) return null;
  return { action, ids };
}

export function readOrderListContext(form: FormData): {
  query: string;
  status: string;
  source: string;
  payment: string;
  from: string;
  to: string;
  tag: string;
  page: number;
} {
  const read = (name: string) => {
    const value = form.get(name);
    return typeof value === 'string' ? value : '';
  };
  const page = Number(read('page'));
  return {
    query: read('q'),
    status: read('status'),
    source: read('source'),
    payment: read('payment'),
    from: read('from'),
    to: read('to'),
    tag: orderListTag(read('tag')),
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

function dayParam(value: string | undefined): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

export type OrderListFilters = {
  query: string;
  status: OrderListStatus;
  source: OrderSource | '';
  payment: PaymentMethod | '';
  start: number | null;
  end: number | null;
  tag?: OrderListTag;
  /** Hướng theo ngày đặt; không áp cho tab «Đã gửi hàng» (luôn theo ngày gửi mới nhất). */
  sort?: OrderSort;
};

export type OrderDayBucket = {
  day: string;
  label: string;
  count: number;
  ids: number[];
};

/** Giới hạn id lấy cho chip chọn theo ngày (tránh payload lớn). */
const ORDER_DAY_SCAN_MAX = 500;

/** Mã đơn dạng VD20261119-0001 — khớp exact để dùng unique index. */
const ORDER_CODE_SEARCH_RE = /^VD\d{8}-\d{4}$/i;

function orderListWhere(filters: OrderListFilters) {
  const term = orderSearchTerm(filters.query);
  const shared = [];
  if (term.phone) {
    // SĐT chuẩn → eq (index); chuỗi số chưa đủ → prefix LIKE (vẫn dùng được index, tránh %…%).
    const exact = normalizePhone(term.phone);
    shared.push(exact ? eq(orders.phone, exact) : like(orders.phone, `${term.phone}%`));
  } else if (term.text) {
    const code = term.text.toUpperCase();
    if (ORDER_CODE_SEARCH_RE.test(code)) {
      shared.push(eq(orders.code, code));
    } else {
      const textLike = `%${term.text}%`;
      shared.push(
        or(
          like(orders.code, textLike),
          like(orders.customerName, textLike),
          like(orders.phone, textLike),
          like(orders.productName, textLike),
          like(orders.note, textLike),
          like(orders.internalNote, textLike),
          sql`exists (
            select 1 from order_items as oi
            where oi.order_id = ${orders.id}
              and (
                oi.product_name like ${textLike}
                or ifnull(oi.note, '') like ${textLike}
              )
          )`,
        ),
      );
    }
  }
  if (filters.start !== null) shared.push(gte(orders.createdAt, filters.start));
  if (filters.end !== null) shared.push(lt(orders.createdAt, filters.end));
  if (filters.source) shared.push(eq(orders.source, filters.source));
  if (filters.payment) shared.push(eq(orders.paymentMethod, filters.payment));
  if (filters.tag === ORDER_TAG_THE_TEN) {
    shared.push(orderTheTenMatchSql());
  }
  const conditions = [...shared];
  const openShip = notInArray(orders.status, ['shipped', 'completed', 'cancelled']);
  const todayStart = vnTodayStartMs();
  if (filters.status === 'processing') {
    conditions.push(inArray(orders.status, ['confirmed', 'preparing', 'shipped']));
  } else if (filters.status === 'unshipped') {
    // Hàng đợi in hàng ngày: chưa gửi / chờ gửi lại / gửi sau đã đến hạn (ẩn gửi sau còn xa).
    conditions.push(
      or(
        eq(orders.fulfillStatus, 'reship'),
        and(
          openShip,
          or(isNull(orders.fulfillStatus), eq(orders.fulfillStatus, 'unshipped')),
          or(isNull(orders.shipOn), lte(orders.shipOn, todayStart)),
        ),
      ),
    );
  } else if (filters.status === 'shipped') {
    conditions.push(or(eq(orders.fulfillStatus, 'shipped'), and(isNull(orders.fulfillStatus), eq(orders.status, 'shipped'))));
  } else if (filters.status === 'later') {
    // Chỉ đơn đặt trước còn chưa tới ngày gửi.
    conditions.push(
      openShip,
      gt(orders.shipOn, todayStart),
      or(isNull(orders.fulfillStatus), eq(orders.fulfillStatus, 'unshipped')),
    );
  } else if (filters.status === 'reship') {
    conditions.push(eq(orders.fulfillStatus, 'reship'));
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}

/** Nhóm id theo ngày đặt (lịch VN). `ids` mỗi ngày tối đa `maxIdsPerDay` (mặc định bulk max). */
export function groupOrdersByCreatedDay(
  rows: { id: number; createdAt: number }[],
  maxIdsPerDay = ORDER_BULK_MAX,
): OrderDayBucket[] {
  const buckets = new Map<string, OrderDayBucket>();
  const order: string[] = [];
  for (const row of rows) {
    const day = vnYmd(vnTodayParts(row.createdAt));
    let bucket = buckets.get(day);
    if (!bucket) {
      const parts = vnTodayParts(row.createdAt);
      bucket = { day, label: `${parts.day}/${parts.month}`, count: 0, ids: [] };
      buckets.set(day, bucket);
      order.push(day);
    }
    bucket.count += 1;
    if (bucket.ids.length < maxIdsPerDay) bucket.ids.push(row.id);
  }
  // Chip: ngày mới trước (chọn nhanh hôm nay / hôm qua).
  // Chip: ngày đặt xa nhất trước — khớp hàng đợi xử lý đơn cũ trước.
  const oldestFirst: OrderDayBucket[] = [];
  for (const day of order) {
    const bucket = buckets.get(day);
    if (bucket && bucket.count > 0) oldestFirst.push(bucket);
  }
  return oldestFirst;
}

/** Id đơn theo ngày đặt — cùng bộ lọc list, đủ để checkbox nhanh (kể cả ngoài trang hiện tại). */
export async function listOrderDayBuckets(db: AppDb, filters: OrderListFilters): Promise<OrderDayBucket[]> {
  const where = orderListWhere(filters);
  const rows = await db
    .select({ id: orders.id, createdAt: orders.createdAt })
    .from(orders)
    .where(where)
    .orderBy(asc(orders.createdAt), asc(orders.id))
    .limit(ORDER_DAY_SCAN_MAX);
  return groupOrdersByCreatedDay(rows);
}

export type OrderTagNote = {
  orderId: number;
  code: string;
  text: string;
};

/** Lưu ý thẻ tên cần đặt làm: chứa từ «thẻ», lấy phần trước dấu phẩy đầu tiên. */
export function extractTheTenNote(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  if (!text.toLowerCase().includes(ORDER_TAG_THE_TEN_MATCH.note)) return null;
  const head = text.split(',')[0]?.trim() ?? '';
  return head || null;
}

/**
 * Chip lưu ý thẻ tên cho các đơn còn phải gửi (chưa gửi + gửi sau).
 * Loại trừ «chờ gửi lại» (reship) và «đã gửi hàng». Gom lưu ý đơn + lưu ý từng dòng SP.
 */
export async function listTheTenTagNotes(db: AppDb, limit = ORDER_DAY_SCAN_MAX): Promise<OrderTagNote[]> {
  const pending = and(
    notInArray(orders.status, ['shipped', 'completed', 'cancelled']),
    or(isNull(orders.fulfillStatus), eq(orders.fulfillStatus, 'unshipped')),
  );
  const rows = await db
    .select({ id: orders.id, code: orders.code, note: orders.note, createdAt: orders.createdAt })
    .from(orders)
    .where(pending)
    .orderBy(asc(orders.createdAt), asc(orders.id))
    .limit(limit);
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const items = await db
    .select({ orderId: orderItems.orderId, note: orderItems.note, sortOrder: orderItems.sortOrder, id: orderItems.id })
    .from(orderItems)
    .where(inArray(orderItems.orderId, ids))
    .orderBy(asc(orderItems.sortOrder), asc(orderItems.id));
  const itemNotes = new Map<number, string[]>();
  for (const item of items) {
    const list = itemNotes.get(item.orderId) ?? [];
    list.push(item.note ?? '');
    itemNotes.set(item.orderId, list);
  }
  const chips: OrderTagNote[] = [];
  for (const row of rows) {
    const orderNote = extractTheTenNote(row.note);
    if (orderNote) chips.push({ orderId: row.id, code: row.code, text: orderNote });
    for (const note of itemNotes.get(row.id) ?? []) {
      const tag = extractTheTenNote(note);
      if (tag) chips.push({ orderId: row.id, code: row.code, text: tag });
    }
  }
  return chips;
}

export async function listOrders(
  db: AppDb,
  filters: OrderListFilters & {
    page: number;
  },
) {
  const where = orderListWhere(filters);
  const page = Math.max(1, filters.page);
  const [totalRows, rows] = await Promise.all([
    db.select({ value: count() }).from(orders).where(where),
    db
      .select({
        id: orders.id,
        code: orders.code,
        customerName: orders.customerName,
        phone: orders.phone,
        address: orders.address,
        note: orders.note,
        internalNote: orders.internalNote,
        productName: orders.productName,
        unitPrice: orders.unitPrice,
        quantity: orders.quantity,
        optionLabel: orders.optionLabel,
        totalPrice: orders.totalPrice,
        paymentMethod: orders.paymentMethod,
        payState: orders.payState,
        depositAmount: orders.depositAmount,
        source: orders.source,
        priority: orders.priority,
        compensation: orders.compensation,
        shipOn: orders.shipOn,
        shippingFee: orders.shippingFee,
        shippingCost: orders.shippingCost,
        costGoods: orders.costGoods,
        costExtra: orders.costExtra,
        status: orders.status,
        fulfillStatus: orders.fulfillStatus,
        shippedAt: orders.shippedAt,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(where)
      .orderBy(...orderListOrderBy(filters))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
  ]);
  const total = totalRows[0]?.value ?? 0;
  // List trống: đếm cả thư viện để phân biệt «chưa có đơn» vs «không khớp bộ lọc/tìm kiếm».
  let libraryTotal = total;
  if (total === 0) {
    const libraryRows = await db.select({ value: count() }).from(orders);
    libraryTotal = libraryRows[0]?.value ?? 0;
  }
  const orderIds = rows.map((row) => row.id);
  const itemRows = orderIds.length === 0
    ? []
    : await db
        .select({
          orderId: orderItems.orderId,
          productName: orderItems.productName,
          unitPrice: orderItems.unitPrice,
          quantity: orderItems.quantity,
          optionLabel: orderItems.optionLabel,
          note: orderItems.note,
        })
        .from(orderItems)
        .where(inArray(orderItems.orderId, orderIds))
        .orderBy(asc(orderItems.sortOrder), asc(orderItems.id));
  const linesByOrder = new Map<number, OrderListLine[]>();
  for (const item of itemRows) {
    const lines = linesByOrder.get(item.orderId) ?? [];
    lines.push({
      productName: item.productName,
      quantity: item.quantity,
      optionLabel: item.optionLabel,
      unitPrice: item.unitPrice,
      note: item.note,
    });
    linesByOrder.set(item.orderId, lines);
  }
  const phones = [...new Set(rows.map((row) => row.phone))];
  const phoneCountRows =
    phones.length === 0
      ? []
      : await db
          .select({ phone: orders.phone, value: count() })
          .from(orders)
          .where(and(inArray(orders.phone, phones), ne(orders.status, 'cancelled')))
          .groupBy(orders.phone);
  const ordersByPhone = new Map(phoneCountRows.map((row) => [row.phone, row.value]));
  return {
    rows: rows.map((row) => ({
      ...row,
      customerOrderCount: ordersByPhone.get(row.phone) ?? 0,
      lines:
        linesByOrder.get(row.id) ??
        [{ productName: row.productName, quantity: row.quantity, optionLabel: row.optionLabel, unitPrice: row.unitPrice, note: null }],
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    libraryTotal,
  };
}

/** Doanh thu + số đơn khớp bộ lọc «Chưa gửi hàng» (ẩn gửi sau còn xa). Gửi bù không cộng doanh thu. */
export async function pendingUnshippedSummary(db: AppDb): Promise<{ revenue: number; orderCount: number }> {
  const pending = orderListWhere({
    query: '',
    status: 'unshipped',
    source: '',
    payment: '',
    start: null,
    end: null,
  });
  const rows = await db
    .select({
      orderCount: count(),
      revenue: sql<number>`coalesce(sum(case when ${orders.compensation} = 0 then ${orders.totalPrice} else 0 end), 0)`,
    })
    .from(orders)
    .where(pending);
  return {
    orderCount: rows[0]?.orderCount ?? 0,
    revenue: Number(rows[0]?.revenue ?? 0),
  };
}

export async function getOrder(db: AppDb, id: number) {
  const rows = await db
    .select({
      id: orders.id,
      code: orders.code,
      customerId: orders.customerId,
      customerName: orders.customerName,
      phone: orders.phone,
      address: orders.address,
      provinceCode: orders.provinceCode,
      note: orders.note,
      internalNote: orders.internalNote,
      productId: orders.productId,
      productName: orders.productName,
      unitPrice: orders.unitPrice,
      quantity: orders.quantity,
      optionLabel: orders.optionLabel,
      totalPrice: orders.totalPrice,
      subtotal: orders.subtotal,
      discountCode: orders.discountCode,
      discountAmount: orders.discountAmount,
      discountRestored: orders.discountRestored,
      paymentMethod: orders.paymentMethod,
      payState: orders.payState,
      depositAmount: orders.depositAmount,
      source: orders.source,
      priority: orders.priority,
      compensation: orders.compensation,
      shipOn: orders.shipOn,
      shippingFee: orders.shippingFee,
      shippingCost: orders.shippingCost,
      costGoods: orders.costGoods,
      costExtra: orders.costExtra,
      costLines: orders.costLines,
      status: orders.status,
      fulfillStatus: orders.fulfillStatus,
      shippedAt: orders.shippedAt,
      createdAt: orders.createdAt,
      updatedAt: orders.updatedAt,
    })
    .from(orders)
    .where(eq(orders.id, id))
    .limit(1);
  const order = rows[0];
  if (!order) return null;
  const items = await db
    .select({
      productId: orderItems.productId,
      productName: orderItems.productName,
      unitPrice: orderItems.unitPrice,
      quantity: orderItems.quantity,
      optionLabel: orderItems.optionLabel,
      note: orderItems.note,
      lineTotal: orderItems.lineTotal,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id))
    .orderBy(asc(orderItems.sortOrder), asc(orderItems.id));
  return { ...order, items };
}

/** Snapshot đơn cho sự kiện Purchase (value + content_ids = slug SP). Không trả PII. */
export type OrderTrackingSnapshot = {
  amount: number;
  currency: 'VND';
  contentName: string | null;
  contentType: 'product' | 'product_group';
  contents: Array<{ id: string; quantity: number }>;
};

/** Giá trị đơn (VND) theo mã — giữ cho chỗ chỉ cần số tiền. */
export async function orderValueByCode(db: AppDb, code: string): Promise<number | null> {
  const snap = await orderTrackingByCode(db, code);
  return snap?.amount ?? null;
}

/** Đơn theo mã + dòng SP (slug) để bắn Purchase khớp ViewContent / AddToCart. */
export async function orderTrackingByCode(db: AppDb, code: string): Promise<OrderTrackingSnapshot | null> {
  if (!/^VD\d{8}-\d{4}$/.test(code)) return null;
  const rows = await db
    .select({
      id: orders.id,
      totalPrice: orders.totalPrice,
      productId: orders.productId,
      productName: orders.productName,
      quantity: orders.quantity,
    })
    .from(orders)
    .where(eq(orders.code, code))
    .limit(1);
  const order = rows[0];
  if (!order || typeof order.totalPrice !== 'number' || order.totalPrice < 0) return null;

  const itemRows = await db
    .select({
      slug: products.slug,
      productName: orderItems.productName,
      quantity: orderItems.quantity,
    })
    .from(orderItems)
    .leftJoin(products, eq(orderItems.productId, products.id))
    .where(eq(orderItems.orderId, order.id))
    .orderBy(asc(orderItems.sortOrder), asc(orderItems.id));

  const contents: Array<{ id: string; quantity: number }> = [];
  const names: string[] = [];
  for (const item of itemRows) {
    if (!item.slug || item.quantity < 1) continue;
    contents.push({ id: item.slug, quantity: item.quantity });
    if (item.productName) names.push(item.productName);
  }

  // Đơn 1 SP cũ / không có order_items: lấy slug từ product_id trên header.
  if (contents.length === 0 && order.productId) {
    const productRows = await db
      .select({ slug: products.slug, name: products.name })
      .from(products)
      .where(eq(products.id, order.productId))
      .limit(1);
    const product = productRows[0];
    if (product?.slug) {
      contents.push({ id: product.slug, quantity: order.quantity > 0 ? order.quantity : 1 });
      names.push(product.name || order.productName);
    }
  }

  return {
    amount: order.totalPrice,
    currency: 'VND',
    contentName: names[0] ?? order.productName ?? null,
    contentType: contents.length > 1 ? 'product_group' : 'product',
    contents,
  };
}

export async function updateOrderStatus(
  db: AppDb,
  id: number,
  status: OrderStatus,
  now = Date.now(),
): Promise<{ ok: true; updatedAt: number } | { ok: false; error: string }> {
  const current = await getOrder(db, id);
  if (!current) return { ok: false, error: 'Không tìm thấy đơn hàng.' };
  if (!isOrderStatus(current.status)) return { ok: false, error: 'Trạng thái hiện tại không hợp lệ.' };
  if (!canTransitionOrder(current.status, status)) return { ok: false, error: orderTransitionError(current.status, status) };
  if (current.status === status) return { ok: true, updatedAt: current.updatedAt };
  const shipPatch =
    status === 'shipped' && current.status !== 'shipped'
      ? { fulfillStatus: 'shipped' as const, shippedAt: current.shippedAt ?? now }
      : {};
  const restore = status === 'cancelled' && current.discountCode && current.discountAmount > 0 && current.discountRestored === 0;
  if (restore && current.discountCode) {
    await commitWrites(db, [
      restoreDiscountQuery(db, current.discountCode, now),
      db.update(orders).set({ status, discountRestored: 1, updatedAt: now, ...shipPatch }).where(eq(orders.id, id)),
    ]);
  } else {
    await db.update(orders).set({ status, updatedAt: now, ...shipPatch }).where(eq(orders.id, id));
  }
  // Hủy đơn / mở lại từ hủy → tính lại badge chat-phone theo SĐT.
  if (current.status === 'cancelled' || status === 'cancelled') {
    await refreshChatPhonePendingByPhone(db, current.phone);
  }
  return { ok: true, updatedAt: now };
}

// Xóa vĩnh viễn một đơn cùng các dòng sản phẩm. Nhật ký chỉ ghi mã đơn, không ghi thông tin khách.
// Nhật ký chạy sau lệnh xóa đơn và chỉ ghi khi lệnh đó thật sự xóa được dòng nào (changes() > 0).
export async function deleteOrder(
  db: AppDb,
  id: number,
  actor?: ActivityActor,
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rows = await db
    .select({
      code: orders.code,
      phone: orders.phone,
      discountCode: orders.discountCode,
      discountAmount: orders.discountAmount,
      discountRestored: orders.discountRestored,
    })
    .from(orders)
    .where(eq(orders.id, id))
    .limit(1);
  const current = rows[0];
  if (!current) return { ok: false, error: 'Không tìm thấy đơn hàng.' };
  await commitWrites(db, [
    ...(current.discountCode && current.discountAmount > 0 && current.discountRestored === 0
      ? [restoreDiscountQuery(db, current.discountCode, now)]
      : []),
    db.delete(orderItems).where(eq(orderItems.orderId, id)),
    db.delete(orders).where(eq(orders.id, id)),
    ...(actor
      ? [
          activityWrite(
            db,
            {
              actorId: actor.id,
              actorName: actor.name,
              action: 'order.delete',
              objectType: 'order',
              objectId: String(id),
              summary: `Đã xóa đơn ${current.code}.`,
              createdAt: now,
            },
            true,
          ),
        ]
      : []),
  ]);
  await refreshChatPhonePendingByPhone(db, current.phone);
  return { ok: true };
}

// Xóa nhiều đơn; mỗi đơn đi đủ luồng deleteOrder (trả mã giảm, xóa dòng, nhật ký).
export async function deleteOrders(
  db: AppDb,
  ids: number[],
  actor?: ActivityActor,
  now = Date.now(),
): Promise<number> {
  let deleted = 0;
  for (const id of ids) {
    const result = await deleteOrder(db, id, actor, now);
    if (result.ok) deleted += 1;
  }
  return deleted;
}

export async function updateOrderNote(
  db: AppDb,
  id: number,
  note: string,
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const text = note.trim();
  if (text.length > 1000) return { ok: false, error: 'Ghi chú nội bộ tối đa 1000 ký tự.' };
  const current = await getOrder(db, id);
  if (!current) return { ok: false, error: 'Không tìm thấy đơn hàng.' };
  const next = text || null;
  if (current.internalNote !== next) {
    await db.update(orders).set({ internalNote: next, updatedAt: now }).where(eq(orders.id, id));
  }
  return { ok: true };
}

export async function updateStaffOrderCustomer(
  db: AppDb,
  id: number,
  input: { customerName: string; phone: string; address: string; note: string },
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; error: string; errors?: FieldErrors }> {
  const current = await getOrder(db, id);
  if (!current) return { ok: false, error: 'Không tìm thấy đơn hàng.' };
  if (!canEditOrderProducts(current.status)) return { ok: false, error: 'Đơn đã kết thúc, không sửa được.' };
  const parsed = readCustomer(input);
  if (Object.keys(parsed.errors).length > 0 || !parsed.phone) {
    return { ok: false, error: 'Thông tin khách chưa hợp lệ.', errors: parsed.errors };
  }
  const customerId = await upsertCustomer(
    db,
    { phone: parsed.phone, name: parsed.customerName, address: parsed.address },
    now,
  );
  const previousPhone = current.phone;
  await db
    .update(orders)
    .set({
      customerId,
      customerName: parsed.customerName,
      phone: parsed.phone,
      address: parsed.address,
      provinceCode: resolveProvinceCode(parsed.address),
      note: parsed.note || null,
      updatedAt: now,
    })
    .where(eq(orders.id, id));
  if (previousPhone !== parsed.phone) {
    await refreshChatPhonePendingByPhone(db, previousPhone);
    await refreshChatPhonePendingByPhone(db, parsed.phone);
  } else if (current.status !== 'cancelled') {
    await clearChatPhonePendingByPhone(db, parsed.phone);
  }
  return { ok: true };
}

export async function updateOrderFulfillStatus(
  db: AppDb,
  id: number,
  fulfill: FulfillStatus,
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const current = await getOrder(db, id);
  if (!current) return { ok: false, error: 'Không tìm thấy đơn hàng.' };
  if (!canEditOrderProducts(current.status)) return { ok: false, error: 'Đơn đã kết thúc, không sửa được.' };
  if (!isFulfillStatus(fulfill)) return { ok: false, error: 'Trạng thái giao không hợp lệ.' };
  const patch: {
    fulfillStatus: FulfillStatus;
    status?: OrderStatus;
    updatedAt: number;
    shipOn?: null;
    shippedAt?: number | null;
  } = {
    fulfillStatus: fulfill,
    updatedAt: now,
  };
  // Đồng bộ status xử lý tối thiểu để list/filter/detail không lệch với trạng thái giao.
  if (fulfill === 'shipped') {
    if (current.status !== 'shipped') patch.status = 'shipped';
    patch.shipOn = null;
    patch.shippedAt = current.shippedAt ?? now;
  } else if (fulfill === 'unshipped' && current.status === 'shipped') {
    patch.status = 'preparing';
    patch.shippedAt = null;
  } else if (fulfill === 'reship') {
    patch.shippedAt = null;
  }
  await db.update(orders).set(patch).where(eq(orders.id, id));
  return { ok: true };
}

// Bật ưu tiên thì bỏ gửi sau (hai cờ không dùng cùng lúc).
export async function updateOrderPriority(
  db: AppDb,
  id: number,
  priority: boolean,
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const current = await getOrder(db, id);
  if (!current) return { ok: false, error: 'Không tìm thấy đơn hàng.' };
  if (!canEditOrderProducts(current.status)) return { ok: false, error: 'Đơn đã kết thúc, không sửa được.' };
  const next = priority ? 1 : 0;
  if (current.priority === next && !(priority && current.shipOn !== null)) return { ok: true };
  await db
    .update(orders)
    .set({
      priority: next,
      ...(priority ? { shipOn: null } : {}),
      updatedAt: now,
    })
    .where(eq(orders.id, id));
  return { ok: true };
}

async function resolvePublicShippingFee(
  db: AppDb,
  lines: ReadonlyArray<{ productId: number; lineTotal: number }>,
): Promise<{ free: boolean; fee: number }> {
  const costs = await listOrderCosts(db);
  const baseFee = baseCustomerShippingFee(costs);
  const ids = [...new Set(lines.map((line) => line.productId).filter((id) => Number.isInteger(id) && id > 0))];
  const rows =
    ids.length === 0
      ? []
      : await db
          .select({ id: products.id, categorySlug: productCategories.slug })
          .from(products)
          .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
          .where(inArray(products.id, ids));
  const slugById = new Map(rows.map((row) => [row.id, row.categorySlug ?? '']));
  return resolveCustomerShippingFee({
    lines: lines.map((line) => ({
      group: shipGroupOf(slugById.get(line.productId)),
      lineTotal: line.lineTotal,
    })),
    baseFee,
  });
}

export async function placeOrder(
  db: AppDb,
  draft: OrderDraft,
  ipHash: string,
  now = Date.now(),
): Promise<{ ok: true; code: string } | { ok: false; status: 409 | 429 | 503; error: string }> {
  const recent = await db
    .select({ value: count() })
    .from(orders)
    .where(and(eq(orders.ipHash, ipHash), gt(orders.createdAt, now - ORDER_IP_WINDOW_MS)));
  if ((recent[0]?.value ?? 0) >= ORDER_IP_LIMIT) {
    return { ok: false, status: 429, error: 'Đặt hàng tạm khóa. Thử lại sau ít phút.' };
  }
  const optionMatch = draft.optionLabel ? eq(orders.optionLabel, draft.optionLabel) : isNull(orders.optionLabel);
  const duplicate = await db
    .select({ createdAt: orders.createdAt })
    .from(orders)
    .where(and(eq(orders.phone, draft.phone), eq(orders.productId, draft.productId), optionMatch))
    .orderBy(desc(orders.createdAt))
    .limit(1);
  if (duplicate[0] && isRecentDuplicate(duplicate[0].createdAt, now)) {
    return { ok: false, status: 409, error: 'Đơn cùng sản phẩm và lựa chọn vừa được gửi. Nếu cần đổi, hãy gọi xưởng.' };
  }
  const ship = await resolvePublicShippingFee(db, [{ productId: draft.productId, lineTotal: draft.subtotal }]);
  const shippingFee = ship.fee;
  const totalPrice = draft.totalPrice + shippingFee;
  const slot = await takeDiscountSlot(db, draft.discountCode, now);
  if (!slot.ok) return { ok: false, status: 409, error: slot.error };
  const snapshot = await snapshotOrderCosts(db, [{ name: draft.productName, productId: draft.productId, quantity: draft.quantity }], totalPrice);
  try {
    const day = orderDayKey(now);
    const latest = await db
      .select({ code: orders.code })
      .from(orders)
      .where(like(orders.code, `VD${day}-%`))
      .orderBy(desc(orders.code))
      .limit(1);
    let sequence = sequenceFromCode(latest[0]?.code ?? '') + 1;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (sequence > 9999) {
        await releaseDiscountSlot(db, slot.id, now);
        return { ok: false, status: 503, error: 'Hết mã đơn trong ngày. Hãy gọi xưởng để đặt.' };
      }
      const code = formatOrderCode(day, sequence);
      try {
        const customerId = await upsertCustomer(
          db,
          { phone: draft.phone, name: draft.customerName, address: draft.address },
          now,
        );
        const inserted = await db
          .insert(orders)
          .values({
            code,
            customerId,
            customerName: draft.customerName,
            phone: draft.phone,
            address: draft.address,
            provinceCode: resolveProvinceCode(draft.address),
            note: draft.note || null,
            productId: draft.productId,
            productName: draft.productName,
            unitPrice: draft.unitPrice,
            quantity: draft.quantity,
            optionLabel: draft.optionLabel,
            subtotal: draft.subtotal,
            discountCode: draft.discountCode,
            discountAmount: draft.discountAmount,
            discountRestored: 0,
            totalPrice,
            costGoods: snapshot?.costGoods ?? null,
            costExtra: snapshot ? snapshot.costExtra : null,
            costLines: snapshot ? encodeCostLines(snapshot) : null,
            paymentMethod: draft.paymentMethod,
            source: 'web',
            shippingFee,
            shippingCost: snapshot?.shippingCost ?? 0,
            status: 'new',
            ipHash,
            landingSlug: draft.landingSlug,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: orders.id });
        // Có tên in thẻ → lưu dòng SP để admin/SPX đọc được lưu ý từng mẫu.
        if (draft.lineNote) {
          const orderId = inserted[0]?.id;
          if (!orderId) {
            await releaseDiscountSlot(db, slot.id, now);
            return { ok: false, status: 503, error: 'Chưa tạo được mã đơn. Thử lại.' };
          }
          try {
            await db.insert(orderItems).values({
              orderId,
              productId: draft.productId,
              productName: draft.productName,
              unitPrice: draft.unitPrice,
              quantity: draft.quantity,
              optionLabel: draft.optionLabel,
              note: draft.lineNote,
              lineTotal: draft.subtotal,
              sortOrder: 0,
            });
          } catch (error) {
            await db.delete(orders).where(eq(orders.id, orderId));
            throw error;
          }
        }
        await clearChatPhonePendingByPhone(db, draft.phone);
        return { ok: true, code };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        sequence += 1;
      }
    }
    await releaseDiscountSlot(db, slot.id, now);
    return { ok: false, status: 503, error: 'Chưa tạo được mã đơn. Thử lại.' };
  } catch (error) {
    await releaseDiscountSlot(db, slot.id, now);
    throw error;
  }
}

export async function placeCartOrder(
  db: AppDb,
  draft: CartOrderDraft,
  ipHash: string,
  now = Date.now(),
): Promise<{ ok: true; code: string } | { ok: false; status: 409 | 429 | 503; error: string }> {
  const recent = await db
    .select({ value: count() })
    .from(orders)
    .where(and(eq(orders.ipHash, ipHash), gt(orders.createdAt, now - ORDER_IP_WINDOW_MS)));
  if ((recent[0]?.value ?? 0) >= ORDER_IP_LIMIT) {
    return { ok: false, status: 429, error: 'Đặt hàng tạm khóa. Thử lại sau ít phút.' };
  }
  const ship = await resolvePublicShippingFee(
    db,
    draft.lines.map((line) => ({ productId: line.productId, lineTotal: line.lineTotal })),
  );
  const shippingFee = ship.fee;
  const totalPrice = draft.totalPrice + shippingFee;
  const duplicate = await db
    .select({ createdAt: orders.createdAt })
    .from(orders)
    .where(and(eq(orders.phone, draft.phone), isNull(orders.productId), eq(orders.productName, draft.productName), eq(orders.totalPrice, totalPrice)))
    .orderBy(desc(orders.createdAt))
    .limit(1);
  if (duplicate[0] && isRecentDuplicate(duplicate[0].createdAt, now)) {
    return { ok: false, status: 409, error: 'Đơn cùng các mẫu vừa được gửi. Nếu cần đổi, hãy gọi xưởng.' };
  }
  const slot = await takeDiscountSlot(db, draft.discountCode, now);
  if (!slot.ok) return { ok: false, status: 409, error: slot.error };
  const snapshot = await snapshotOrderCosts(
    db,
    draft.lines.map((line) => ({ name: line.productName, productId: line.productId, quantity: line.quantity })),
    totalPrice,
  );
  try {
    const day = orderDayKey(now);
    const latest = await db
      .select({ code: orders.code })
      .from(orders)
      .where(like(orders.code, `VD${day}-%`))
      .orderBy(desc(orders.code))
      .limit(1);
    let sequence = sequenceFromCode(latest[0]?.code ?? '') + 1;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (sequence > 9999) {
        await releaseDiscountSlot(db, slot.id, now);
        return { ok: false, status: 503, error: 'Hết mã đơn trong ngày. Hãy gọi xưởng để đặt.' };
      }
      const code = formatOrderCode(day, sequence);
      try {
        const customerId = await upsertCustomer(
          db,
          { phone: draft.phone, name: draft.customerName, address: draft.address },
          now,
        );
        const inserted = await db
          .insert(orders)
          .values({
            code,
            customerId,
            customerName: draft.customerName,
            phone: draft.phone,
            address: draft.address,
            provinceCode: resolveProvinceCode(draft.address),
            note: draft.note || null,
            productId: null,
            productName: draft.productName,
            unitPrice: 0,
            quantity: draft.quantity,
            optionLabel: null,
            subtotal: draft.subtotal,
            discountCode: draft.discountCode,
            discountAmount: draft.discountAmount,
            discountRestored: 0,
            totalPrice,
            costGoods: snapshot?.costGoods ?? null,
            costExtra: snapshot ? snapshot.costExtra : null,
            costLines: snapshot ? encodeCostLines(snapshot) : null,
            paymentMethod: draft.paymentMethod,
            source: 'web',
            shippingFee,
            shippingCost: snapshot?.shippingCost ?? 0,
            status: 'new',
            ipHash,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: orders.id });
        const orderId = inserted[0]?.id;
        if (!orderId) {
          await releaseDiscountSlot(db, slot.id, now);
          return { ok: false, status: 503, error: 'Chưa tạo được mã đơn. Thử lại.' };
        }
        try {
          await db.insert(orderItems).values(
            draft.lines.map((line, index) => ({
              orderId,
              productId: line.productId,
              productName: line.productName,
              unitPrice: line.unitPrice,
              quantity: line.quantity,
              optionLabel: line.optionLabel,
              note: line.note,
              lineTotal: line.lineTotal,
              sortOrder: index,
            })),
          );
        } catch (error) {
          await db.delete(orders).where(eq(orders.id, orderId));
          throw error;
        }
        await clearChatPhonePendingByPhone(db, draft.phone);
        return { ok: true, code };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        sequence += 1;
      }
    }
    await releaseDiscountSlot(db, slot.id, now);
    return { ok: false, status: 503, error: 'Chưa tạo được mã đơn. Thử lại.' };
  } catch (error) {
    await releaseDiscountSlot(db, slot.id, now);
    throw error;
  }
}

async function takeDiscountSlot(
  db: AppDb,
  code: string | null,
  now: number,
): Promise<{ ok: true; id: number | null } | { ok: false; error: string }> {
  if (!code) return { ok: true, id: null };
  const id = await claimDiscount(db, code, now);
  if (id === null) return { ok: false, error: 'Mã giảm giá vừa hết lượt hoặc không còn dùng được.' };
  return { ok: true, id };
}

async function releaseDiscountSlot(db: AppDb, id: number | null, now: number): Promise<void> {
  if (id !== null) await releaseDiscount(db, id, now);
}

// Đơn nhân viên tạo (Zalo, Facebook...): không khóa theo IP và không chặn đơn giống nhau, vì xưởng nhập nhiều đơn liên tiếp.
export async function createStaffOrder(
  db: AppDb,
  draft: StaffOrderDraft,
  staffUserId: number,
  now = Date.now(),
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  if (draft.lines.length < 1) return { ok: false, error: 'Thêm ít nhất một sản phẩm.' };
  const columns = staffOrderColumns(draft.lines);
  const flags = draft.flags;
  const rawCode = flags.compensation ? '' : (draft.discountCode ?? '');
  let codeAmount = 0;
  let codeLabel: string | null = null;
  if (rawCode.trim()) {
    const quoted = await quoteStaffDiscount(db, columns.subtotal, rawCode, now);
    if (!quoted.ok) return quoted;
    if (!quoted.discount) return { ok: false, error: 'Mã không dùng được.' };
    codeAmount = quoted.discount.discountAmount;
    codeLabel = quoted.discount.code;
  }
  const settled = settleStaffTotal(
    columns.subtotal,
    codeAmount,
    flags.compensation ? '' : (draft.orderTotal ?? ''),
    flags.compensation ? '' : (draft.discountExtra ?? ''),
  );
  if (!settled.ok) return settled;
  const collected = applyStaffCollection(settled.totalPrice, settled.discountAmount, codeLabel, flags);
  if (!collected.ok) return collected;
  const depositError = validateOrderDeposit(flags.payState, flags.depositAmount, collected.totalPrice);
  if (depositError) return { ok: false, error: depositError };
  const depositAmount = flags.payState === 'deposit' ? flags.depositAmount : 0;
  const slot = await takeDiscountSlot(db, collected.discountCode, now);
  if (!slot.ok) return slot;
  const discountCode = collected.discountCode;
  const discountAmount = collected.discountAmount;
  const totalPrice = collected.totalPrice;
  const snapshot = await snapshotOrderCosts(
    db,
    draft.lines.map((line) => ({
      name: line.productName,
      productId: line.productId,
      quantity: line.quantity,
      unitCost: line.unitCost,
    })),
    totalPrice,
  );
  const day = orderDayKey(now);
  const latest = await db
    .select({ code: orders.code })
    .from(orders)
    .where(like(orders.code, `VD${day}-%`))
    .orderBy(desc(orders.code))
    .limit(1);
  let sequence = sequenceFromCode(latest[0]?.code ?? '') + 1;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (sequence > 9999) {
      await releaseDiscountSlot(db, slot.id, now);
      return { ok: false, error: 'Hết mã đơn trong ngày. Hãy thử lại vào ngày mai.' };
    }
    const code = formatOrderCode(day, sequence);
    try {
      const customerId = await upsertCustomer(
        db,
        { phone: draft.phone, name: draft.customerName, address: draft.address },
        now,
      );
      const inserted = await db
        .insert(orders)
        .values({
          code,
          customerId,
          customerName: draft.customerName,
          phone: draft.phone,
          address: draft.address,
          provinceCode: resolveProvinceCode(draft.address),
          note: draft.note || null,
          productId: columns.productId,
          productName: columns.productName,
          unitPrice: columns.unitPrice,
          quantity: columns.quantity,
          optionLabel: columns.optionLabel,
          subtotal: columns.subtotal,
          discountCode,
          discountAmount,
          discountRestored: 0,
          totalPrice,
          costGoods: snapshot?.costGoods ?? null,
          costExtra: snapshot ? snapshot.costExtra : null,
          costLines: snapshot ? encodeCostLines(snapshot) : null,
          paymentMethod: flags.paymentMethod,
          source: flags.source,
          payState: flags.payState,
          depositAmount,
          priority: flags.priority ? 1 : 0,
          compensation: flags.compensation ? 1 : 0,
          shipOn: flags.shipOn,
          shippingFee: collected.shippingFee,
          shippingCost: snapshot?.shippingCost ?? 0,
          status: 'new',
          ipHash: `staff:${staffUserId}`,
          landingSlug: null,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: orders.id });
      const orderId = inserted[0]?.id;
      if (!orderId) {
        await releaseDiscountSlot(db, slot.id, now);
        return { ok: false, error: 'Chưa tạo được đơn. Thử lại.' };
      }
      // Luôn ghi order_items để giữ lưu ý từng SP (kể cả đơn 1 dòng).
      try {
        await db.insert(orderItems).values(itemValues(orderId, draft.lines));
      } catch (error) {
        await db.delete(orders).where(eq(orders.id, orderId));
        throw error;
      }
      await clearChatPhonePendingByPhone(db, draft.phone);
      return { ok: true, id: orderId };
    } catch (error) {
      if (!isUniqueViolation(error)) {
        await releaseDiscountSlot(db, slot.id, now);
        throw error;
      }
      sequence += 1;
    }
  }
  await releaseDiscountSlot(db, slot.id, now);
  return { ok: false, error: 'Chưa tạo được mã đơn. Thử lại.' };
}

// Cập nhật đủ khách + dòng SP + cờ thu/giao như form thêm đơn.
export async function updateStaffOrder(
  db: AppDb,
  id: number,
  draft: StaffOrderDraft,
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const current = await getOrder(db, id);
  if (!current) return { ok: false, error: 'Không tìm thấy đơn hàng.' };
  if (!canEditOrderProducts(current.status)) return { ok: false, error: 'Đơn đã kết thúc, không sửa được.' };
  if (draft.lines.length < 1) return { ok: false, error: 'Thêm ít nhất một sản phẩm.' };
  const columns = staffOrderColumns(draft.lines);
  const flags = draft.flags;
  const rawCode = flags.compensation ? '' : (draft.discountCode ?? '');
  const discount = await resolveStaffDiscount(db, current, columns.subtotal, rawCode, now);
  if (!discount.ok) return discount;
  const settled = settleStaffTotal(
    columns.subtotal,
    discount.amount,
    flags.compensation ? '' : (draft.orderTotal ?? ''),
    flags.compensation ? '' : (draft.discountExtra ?? ''),
  );
  if (!settled.ok) return settled;
  const baseCode = discount.amount > 0 ? discount.code : null;
  const collected = applyStaffCollection(settled.totalPrice, settled.discountAmount, baseCode, flags);
  if (!collected.ok) return collected;
  const depositError = validateOrderDeposit(flags.payState, flags.depositAmount, collected.totalPrice);
  if (depositError) return { ok: false, error: depositError };
  const depositAmount = flags.payState === 'deposit' ? flags.depositAmount : 0;
  const holdsUse = Boolean(current.discountCode && current.discountAmount > 0 && current.discountRestored === 0);
  const code = collected.discountCode;
  const amount = collected.discountAmount;
  const claim = code ? discount.claim : null;
  const restore = code ? discount.restore : holdsUse;
  const totalPrice = collected.totalPrice;
  const snapshot = await snapshotOrderCosts(
    db,
    draft.lines.map((line) => ({
      name: line.productName,
      productId: line.productId,
      quantity: line.quantity,
      unitCost: line.unitCost,
    })),
    totalPrice,
  );
  if (!snapshot) return { ok: false, error: 'Chưa tính lại được chi phí. Thử lại.' };
  const slot = await takeDiscountSlot(db, claim, now);
  if (!slot.ok) return slot;
  try {
    const customerId = await upsertCustomer(
      db,
      { phone: draft.phone, name: draft.customerName, address: draft.address },
      now,
    );
    await commitWrites(db, [
      db
        .update(orders)
        .set({
          customerId,
          customerName: draft.customerName,
          phone: draft.phone,
          address: draft.address,
          provinceCode: resolveProvinceCode(draft.address),
          note: draft.note || null,
          productId: columns.productId,
          productName: columns.productName,
          unitPrice: columns.unitPrice,
          quantity: columns.quantity,
          optionLabel: columns.optionLabel,
          subtotal: columns.subtotal,
          discountCode: code,
          discountAmount: amount,
          discountRestored: restore && !claim ? 1 : claim ? 0 : current.discountRestored,
          totalPrice,
          costGoods: snapshot.costGoods,
          costExtra: snapshot.costExtra,
          costLines: encodeCostLines(snapshot),
          paymentMethod: flags.paymentMethod,
          source: flags.source,
          payState: flags.payState,
          depositAmount,
          priority: flags.priority ? 1 : 0,
          compensation: flags.compensation ? 1 : 0,
          shipOn: flags.shipOn,
          shippingFee: collected.shippingFee,
          shippingCost: snapshot.shippingCost,
          updatedAt: now,
        })
        .where(eq(orders.id, id)),
      db.delete(orderItems).where(eq(orderItems.orderId, id)),
      db.insert(orderItems).values(itemValues(id, draft.lines)),
      ...(restore && current.discountCode ? [restoreDiscountQuery(db, current.discountCode, now)] : []),
    ]);
  } catch (error) {
    await releaseDiscountSlot(db, slot.id, now);
    throw error;
  }
  if (current.phone !== draft.phone) {
    await refreshChatPhonePendingByPhone(db, current.phone);
    await refreshChatPhonePendingByPhone(db, draft.phone);
  } else if (current.status !== 'cancelled') {
    await clearChatPhonePendingByPhone(db, draft.phone);
  }
  return { ok: true };
}

export async function updateStaffOrderLines(
  db: AppDb,
  id: number,
  lines: StaffOrderDraft['lines'],
  rawDiscountCode: string,
  rawTotal: string,
  rawExtra = '',
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const current = await getOrder(db, id);
  if (!current) return { ok: false, error: 'Không tìm thấy đơn hàng.' };
  if (!canEditOrderProducts(current.status)) return { ok: false, error: 'Đơn đã kết thúc, không sửa sản phẩm.' };
  if (lines.length < 1) return { ok: false, error: 'Thêm ít nhất một sản phẩm.' };
  const columns = staffOrderColumns(lines);
  const compensation = current.compensation === 1;
  const discount = await resolveStaffDiscount(db, current, columns.subtotal, compensation ? '' : rawDiscountCode, now);
  if (!discount.ok) return discount;
  const settled = settleStaffTotal(columns.subtotal, discount.amount, compensation ? '' : rawTotal, compensation ? '' : rawExtra);
  if (!settled.ok) return settled;
  const baseCode = discount.amount > 0 ? discount.code : null;
  // Đồng bộ ship với rule POS/admin: đổi SL có thể đủ/hết miễn ship — không giữ phí cũ.
  const ship = compensation
    ? { free: true, fee: 0 }
    : await resolvePublicShippingFee(
        db,
        lines
          .filter((line): line is typeof line & { productId: number } => line.productId != null)
          .map((line) => ({ productId: line.productId, lineTotal: line.lineTotal })),
      );
  const collected = applyStaffCollection(settled.totalPrice, settled.discountAmount, baseCode, {
    compensation,
    shippingFee: ship.fee,
  });
  if (!collected.ok) return collected;
  const holdsUse = Boolean(current.discountCode && current.discountAmount > 0 && current.discountRestored === 0);
  const code = collected.discountCode;
  const amount = collected.discountAmount;
  const claim = code ? discount.claim : null;
  const restore = code ? discount.restore : holdsUse;
  const totalPrice = collected.totalPrice;
  const snapshot = await snapshotOrderCosts(
    db,
    lines.map((line) => ({
      name: line.productName,
      productId: line.productId,
      quantity: line.quantity,
      unitCost: line.unitCost,
    })),
    totalPrice,
  );
  if (!snapshot) return { ok: false, error: 'Chưa tính lại được chi phí. Thử lại.' };
  const slot = await takeDiscountSlot(db, claim, now);
  if (!slot.ok) return slot;
  try {
    await commitWrites(db, [
      db
        .update(orders)
        .set({
          productId: columns.productId,
          productName: columns.productName,
          unitPrice: columns.unitPrice,
          quantity: columns.quantity,
          optionLabel: columns.optionLabel,
          subtotal: columns.subtotal,
          discountCode: code,
          discountAmount: amount,
          discountRestored: restore && !claim ? 1 : claim ? 0 : current.discountRestored,
          totalPrice,
          shippingFee: collected.shippingFee,
          costGoods: snapshot.costGoods,
          costExtra: snapshot.costExtra,
          costLines: encodeCostLines(snapshot),
          shippingCost: snapshot.shippingCost,
          updatedAt: now,
        })
        .where(eq(orders.id, id)),
      db.delete(orderItems).where(eq(orderItems.orderId, id)),
      db.insert(orderItems).values(itemValues(id, lines)),
      ...(restore && current.discountCode ? [restoreDiscountQuery(db, current.discountCode, now)] : []),
    ]);
  } catch (error) {
    await releaseDiscountSlot(db, slot.id, now);
    throw error;
  }
  return { ok: true };
}

export async function updateStaffOrderMeta(
  db: AppDb,
  id: number,
  flags: StaffFlags,
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const current = await getOrder(db, id);
  if (!current) return { ok: false, error: 'Không tìm thấy đơn hàng.' };
  if (!canEditOrderProducts(current.status)) return { ok: false, error: 'Đơn đã kết thúc, không sửa được.' };
  const subtotal = current.subtotal ?? current.totalPrice + current.discountAmount;
  const keptDiscount = current.compensation === 1 ? 0 : current.discountAmount;
  const goodsPayable = Math.max(0, subtotal - keptDiscount);
  const collected = applyStaffCollection(goodsPayable, keptDiscount, current.compensation === 1 ? null : current.discountCode, flags);
  if (!collected.ok) return collected;
  const depositError = validateOrderDeposit(flags.payState, flags.depositAmount, collected.totalPrice);
  if (depositError) return { ok: false, error: depositError };
  const depositAmount = flags.payState === 'deposit' ? flags.depositAmount : 0;
  const holdsUse = Boolean(current.discountCode && current.discountAmount > 0 && current.discountRestored === 0);
  const restore = flags.compensation && holdsUse;
  const moneyChanged = collected.totalPrice !== current.totalPrice;
  const snapshot = moneyChanged
    ? await snapshotOrderCosts(
        db,
        orderLineSources(current).map((line) => ({ name: line.productName, productId: line.productId, quantity: line.quantity })),
        collected.totalPrice,
      )
    : null;
  if (moneyChanged && !snapshot) return { ok: false, error: 'Chưa tính lại được chi phí. Thử lại.' };
  await commitWrites(db, [
    db
      .update(orders)
      .set({
        paymentMethod: flags.paymentMethod,
        source: flags.source,
        payState: flags.payState,
        depositAmount,
        priority: flags.priority ? 1 : 0,
        compensation: flags.compensation ? 1 : 0,
        shipOn: flags.shipOn,
        shippingFee: collected.shippingFee,
        shippingCost: snapshot ? snapshot.shippingCost : current.shippingCost,
        discountCode: collected.discountCode,
        discountAmount: collected.discountAmount,
        discountRestored: restore ? 1 : current.discountRestored,
        totalPrice: collected.totalPrice,
        ...(snapshot ? { costGoods: snapshot.costGoods, costExtra: snapshot.costExtra, costLines: encodeCostLines(snapshot) } : {}),
        updatedAt: now,
      })
      .where(eq(orders.id, id)),
    ...(restore && current.discountCode ? [restoreDiscountQuery(db, current.discountCode, now)] : []),
  ]);
  return { ok: true };
}

// Giữ mã cũ thì tính lại số giảm nếu mã còn dùng được, không thì giữ số đã lưu và không vượt tạm tính.
// Đổi mã thì trả lượt mã cũ và lấy lượt mã mới. Bỏ mã thì trả lượt.
async function resolveStaffDiscount(
  db: AppDb,
  current: { discountCode: string | null; discountAmount: number; discountRestored: number },
  subtotal: number,
  rawCode: string,
  now: number,
): Promise<{ ok: true; code: string | null; amount: number; claim: string | null; restore: boolean } | { ok: false; error: string }> {
  const holdsUse = Boolean(current.discountCode && current.discountAmount > 0 && current.discountRestored === 0);
  const typed = rawCode.trim();
  if (!typed) return { ok: true, code: null, amount: 0, claim: null, restore: holdsUse };
  const code = normalizeDiscountCode(typed);
  if (!code) return { ok: false, error: 'Mã giảm giá không hợp lệ.' };
  if (code === current.discountCode) {
    const quoted = await quoteStaffDiscount(db, subtotal, code, now);
    const amount = quoted.ok && quoted.discount ? quoted.discount.discountAmount : capDiscount(subtotal, current.discountAmount).discountAmount;
    return { ok: true, code, amount, claim: null, restore: false };
  }
  const quoted = await quoteStaffDiscount(db, subtotal, code, now);
  if (!quoted.ok || !quoted.discount) return { ok: false, error: quoted.ok ? 'Mã không dùng được.' : quoted.error };
  return { ok: true, code: quoted.discount.code, amount: quoted.discount.discountAmount, claim: quoted.discount.code, restore: holdsUse };
}

function itemValues(orderId: number, lines: StaffOrderDraft['lines']) {
  return lines.map((line, index) => ({
    orderId,
    productId: line.productId,
    productName: line.productName,
    unitPrice: line.unitPrice,
    quantity: line.quantity,
    optionLabel: line.optionLabel,
    note: line.note,
    lineTotal: line.lineTotal,
    sortOrder: index,
  }));
}

