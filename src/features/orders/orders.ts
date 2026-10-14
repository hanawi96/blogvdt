import { and, count, desc, eq, gt, isNull, like, or } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { orders } from '../../lib/db/schema';
import {
  formatOrderCode,
  isRecentDuplicate,
  isUniqueViolation,
  normalizePhone,
  ORDER_IP_LIMIT,
  ORDER_IP_WINDOW_MS,
  orderDayKey,
  sequenceFromCode,
  type OrderDraft,
} from './order';
import type { OrderStatus } from './status';

const PAGE_SIZE = 20;

export async function listOrders(db: AppDb, filters: { query: string; status: OrderStatus | ''; page: number }) {
  const term = searchTerm(filters.query);
  const conditions = [];
  if (filters.status) conditions.push(eq(orders.status, filters.status));
  if (term.phone) conditions.push(like(orders.phone, `%${term.phone}%`));
  else if (term.text) {
    conditions.push(or(like(orders.code, `%${term.text}%`), like(orders.customerName, `%${term.text}%`), like(orders.phone, `%${term.text}%`)));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const page = Math.max(1, filters.page);
  const totalRows = await db.select({ value: count() }).from(orders).where(where);
  const total = totalRows[0]?.value ?? 0;
  const rows = await db
    .select({
      id: orders.id,
      code: orders.code,
      customerName: orders.customerName,
      productName: orders.productName,
      status: orders.status,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(where)
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
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
      productId: orders.productId,
      productName: orders.productName,
      unitPrice: orders.unitPrice,
      quantity: orders.quantity,
      optionLabel: orders.optionLabel,
      totalPrice: orders.totalPrice,
      status: orders.status,
      createdAt: orders.createdAt,
      updatedAt: orders.updatedAt,
    })
    .from(orders)
    .where(eq(orders.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateOrderStatus(
  db: AppDb,
  id: number,
  status: OrderStatus,
  now = Date.now(),
): Promise<{ ok: true; updatedAt: number } | { ok: false; error: string }> {
  const current = await getOrder(db, id);
  if (!current) return { ok: false, error: 'Không tìm thấy đơn hàng.' };
  await db.update(orders).set({ status, updatedAt: now }).where(eq(orders.id, id));
  return { ok: true, updatedAt: now };
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
        status: 'new',
        ipHash,
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

function searchTerm(query: string): { text: string; phone: string } {
  const text = query.replace(/[%_]/g, '').trim().slice(0, 80);
  const digits = text.replace(/\D/g, '');
  if (/^[\d\s.+\-()]+$/.test(text) && digits.length >= 8) return { text: '', phone: normalizePhone(text) ?? digits };
  return { text, phone: '' };
}
