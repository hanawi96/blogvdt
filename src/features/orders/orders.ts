import { and, asc, count, desc, eq, gte, gt, inArray, isNull, like, lt, or } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { routes } from '../../lib/routes';
import { orderItems, orders } from '../../lib/db/schema';
import { activityWrite, commitWrites, type ActivityActor } from '../activity/log';
import {
  formatOrderCode,
  isRecentDuplicate,
  isUniqueViolation,
  normalizePhone,
  ORDER_IP_LIMIT,
  ORDER_IP_WINDOW_MS,
  orderDayKey,
  sequenceFromCode,
  type CartOrderDraft,
  type OrderDraft,
} from './order';
import { canTransitionOrder, isOrderStatus, orderCounts, orderTransitionError, type OrderStatus } from './status';

const PAGE_SIZE = 20;

export type OrderListStatus = OrderStatus | '' | 'processing';

export function orderListStatus(value: string | null | undefined): OrderListStatus {
  if (value === 'processing') return 'processing';
  if (value && isOrderStatus(value)) return value;
  return '';
}

export function orderAdminQuery(input: { query?: string; status?: string; from?: string; to?: string; page?: number }): string {
  const params = new URLSearchParams();
  const query = (input.query ?? '').replace(/[%_]/g, '').trim().slice(0, 80);
  const status = orderListStatus(input.status);
  const from = dayParam(input.from);
  const to = dayParam(input.to);
  const page = input.page && Number.isInteger(input.page) && input.page > 1 ? input.page : 0;
  if (query) params.set('q', query);
  if (status) params.set('status', status);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (page) params.set('page', String(page));
  const text = params.toString();
  return text ? `${routes.adminOrders}?${text}` : routes.adminOrders;
}

function dayParam(value: string | undefined): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

export async function listOrders(
  db: AppDb,
  filters: { query: string; status: OrderListStatus; page: number; start: number | null; end: number | null },
) {
  const term = orderSearchTerm(filters.query);
  const shared = [];
  if (term.phone) shared.push(like(orders.phone, `%${term.phone}%`));
  else if (term.text) {
    shared.push(or(like(orders.code, `%${term.text}%`), like(orders.customerName, `%${term.text}%`), like(orders.phone, `%${term.text}%`)));
  }
  if (filters.start !== null) shared.push(gte(orders.createdAt, filters.start));
  if (filters.end !== null) shared.push(lt(orders.createdAt, filters.end));
  const conditions = [...shared];
  if (filters.status === 'processing') conditions.push(inArray(orders.status, ['confirmed', 'preparing', 'shipped']));
  else if (filters.status) conditions.push(eq(orders.status, filters.status));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const countWhere = shared.length > 0 ? and(...shared) : undefined;
  const page = Math.max(1, filters.page);
  const narrowed = Boolean(filters.status || term.text || term.phone || filters.start !== null || filters.end !== null);
  const [totalRows, countRows, libraryRows, rows] = await Promise.all([
    db.select({ value: count() }).from(orders).where(where),
    db.select({ status: orders.status, value: count() }).from(orders).where(countWhere).groupBy(orders.status),
    narrowed ? db.select({ value: count() }).from(orders) : Promise.resolve([]),
    db
      .select({
        id: orders.id,
        code: orders.code,
        customerName: orders.customerName,
        productName: orders.productName,
        totalPrice: orders.totalPrice,
        status: orders.status,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(where)
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
  ]);
  const total = totalRows[0]?.value ?? 0;
  const counts = orderCounts(countRows);
  return {
    rows,
    total,
    page,
    pageSize: PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    counts,
    libraryTotal: narrowed ? (libraryRows[0]?.value ?? 0) : counts.all,
  };
}

export async function getOrder(db: AppDb, id: number) {
  const rows = await db
    .select({
      id: orders.id,
      code: orders.code,
      customerName: orders.customerName,
      phone: orders.phone,
      address: orders.address,
      note: orders.note,
      internalNote: orders.internalNote,
      productId: orders.productId,
      productName: orders.productName,
      unitPrice: orders.unitPrice,
      quantity: orders.quantity,
      optionLabel: orders.optionLabel,
      totalPrice: orders.totalPrice,
      paymentMethod: orders.paymentMethod,
      costGoods: orders.costGoods,
      costExtra: orders.costExtra,
      status: orders.status,
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
      lineTotal: orderItems.lineTotal,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id))
    .orderBy(asc(orderItems.sortOrder), asc(orderItems.id));
  return { ...order, items };
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
  if (current.status !== status) {
    await db.update(orders).set({ status, updatedAt: now }).where(eq(orders.id, id));
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
  const rows = await db.select({ code: orders.code }).from(orders).where(eq(orders.id, id)).limit(1);
  const current = rows[0];
  if (!current) return { ok: false, error: 'Không tìm thấy đơn hàng.' };
  await commitWrites(db, [
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
  return { ok: true };
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
  const day = orderDayKey(now);
  const latest = await db
    .select({ code: orders.code })
    .from(orders)
    .where(like(orders.code, `VD${day}-%`))
    .orderBy(desc(orders.code))
    .limit(1);
  let sequence = sequenceFromCode(latest[0]?.code ?? '') + 1;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (sequence > 9999) return { ok: false, status: 503, error: 'Hết mã đơn trong ngày. Hãy gọi xưởng để đặt.' };
    const code = formatOrderCode(day, sequence);
    try {
      await db.insert(orders).values({
        code,
        customerName: draft.customerName,
        phone: draft.phone,
        address: draft.address,
        note: draft.note || null,
        productId: draft.productId,
        productName: draft.productName,
        unitPrice: draft.unitPrice,
        quantity: draft.quantity,
        optionLabel: draft.optionLabel,
        totalPrice: draft.totalPrice,
        paymentMethod: draft.paymentMethod,
        status: 'new',
        ipHash,
        landingSlug: draft.landingSlug,
        createdAt: now,
        updatedAt: now,
      });
      return { ok: true, code };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      sequence += 1;
    }
  }
  return { ok: false, status: 503, error: 'Chưa tạo được mã đơn. Thử lại.' };
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
  const duplicate = await db
    .select({ createdAt: orders.createdAt })
    .from(orders)
    .where(and(eq(orders.phone, draft.phone), isNull(orders.productId), eq(orders.productName, draft.productName), eq(orders.totalPrice, draft.totalPrice)))
    .orderBy(desc(orders.createdAt))
    .limit(1);
  if (duplicate[0] && isRecentDuplicate(duplicate[0].createdAt, now)) {
    return { ok: false, status: 409, error: 'Đơn cùng các mẫu vừa được gửi. Nếu cần đổi, hãy gọi xưởng.' };
  }
  const day = orderDayKey(now);
  const latest = await db
    .select({ code: orders.code })
    .from(orders)
    .where(like(orders.code, `VD${day}-%`))
    .orderBy(desc(orders.code))
    .limit(1);
  let sequence = sequenceFromCode(latest[0]?.code ?? '') + 1;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (sequence > 9999) return { ok: false, status: 503, error: 'Hết mã đơn trong ngày. Hãy gọi xưởng để đặt.' };
    const code = formatOrderCode(day, sequence);
    try {
      const inserted = await db
        .insert(orders)
        .values({
          code,
          customerName: draft.customerName,
          phone: draft.phone,
          address: draft.address,
          note: draft.note || null,
          productId: null,
          productName: draft.productName,
          unitPrice: 0,
          quantity: draft.quantity,
          optionLabel: null,
          totalPrice: draft.totalPrice,
          paymentMethod: draft.paymentMethod,
          status: 'new',
          ipHash,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: orders.id });
      const orderId = inserted[0]?.id;
      if (!orderId) return { ok: false, status: 503, error: 'Chưa tạo được mã đơn. Thử lại.' };
      try {
        await db.insert(orderItems).values(
          draft.lines.map((line, index) => ({
            orderId,
            productId: line.productId,
            productName: line.productName,
            unitPrice: line.unitPrice,
            quantity: line.quantity,
            optionLabel: line.optionLabel,
            lineTotal: line.lineTotal,
            sortOrder: index,
          })),
        );
      } catch (error) {
        await db.delete(orders).where(eq(orders.id, orderId));
        throw error;
      }
      return { ok: true, code };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      sequence += 1;
    }
  }
  return { ok: false, status: 503, error: 'Chưa tạo được mã đơn. Thử lại.' };
}

export function orderSearchTerm(query: string): { text: string; phone: string } {
  const text = query.replace(/[%_]/g, '').trim().slice(0, 80);
  const digits = text.replace(/\D/g, '');
  if (/^[\d\s.+\-()]+$/.test(text) && digits.length >= 8) return { text: '', phone: normalizePhone(text) ?? digits };
  return { text, phone: '' };
}
