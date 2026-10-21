import { and, asc, count, desc, eq, gte, gt, inArray, isNull, like, lt, or } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { routes } from '../../lib/routes';
import { orderItems, orders } from '../../lib/db/schema';
import { activityWrite, commitWrites, type ActivityActor } from '../activity/log';
import { claimDiscount, quoteStaffDiscount, releaseDiscount, restoreDiscountQuery } from '../discounts/discounts';
import { normalizeDiscountCode } from '../discounts/quote';
import { encodeCostLines, snapshotOrderCosts } from '../costs/order-costs';
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
import { applyStaffCollection, canEditOrderProducts, capDiscount, orderLineSources, settleStaffTotal, staffOrderColumns, type StaffFlags, type StaffOrderDraft } from './staff';
import { canTransitionOrder, isOrderStatus, orderCounts, orderTransitionError, type OrderStatus } from './status';

const PAGE_SIZE = 20;

type OrderListLine = { productName: string; quantity: number; optionLabel: string | null; unitPrice: number };

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
        unitPrice: orders.unitPrice,
        quantity: orders.quantity,
        optionLabel: orders.optionLabel,
        totalPrice: orders.totalPrice,
        paymentMethod: orders.paymentMethod,
        payState: orders.payState,
        source: orders.source,
        priority: orders.priority,
        compensation: orders.compensation,
        shipOn: orders.shipOn,
        shippingFee: orders.shippingFee,
        shippingCost: orders.shippingCost,
        costGoods: orders.costGoods,
        costExtra: orders.costExtra,
        status: orders.status,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(where)
      .orderBy(desc(orders.priority), desc(orders.createdAt), desc(orders.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
  ]);
  const total = totalRows[0]?.value ?? 0;
  const counts = orderCounts(countRows);
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
        })
        .from(orderItems)
        .where(inArray(orderItems.orderId, orderIds))
        .orderBy(asc(orderItems.sortOrder), asc(orderItems.id));
  const linesByOrder = new Map<number, OrderListLine[]>();
  for (const item of itemRows) {
    const lines = linesByOrder.get(item.orderId) ?? [];
    lines.push({ productName: item.productName, quantity: item.quantity, optionLabel: item.optionLabel, unitPrice: item.unitPrice });
    linesByOrder.set(item.orderId, lines);
  }
  return {
    rows: rows.map((row) => ({
      ...row,
      lines: linesByOrder.get(row.id) ?? [{ productName: row.productName, quantity: row.quantity, optionLabel: row.optionLabel, unitPrice: row.unitPrice }],
    })),
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
      subtotal: orders.subtotal,
      discountCode: orders.discountCode,
      discountAmount: orders.discountAmount,
      discountRestored: orders.discountRestored,
      paymentMethod: orders.paymentMethod,
      payState: orders.payState,
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
  if (current.status === status) return { ok: true, updatedAt: current.updatedAt };
  const restore = status === 'cancelled' && current.discountCode && current.discountAmount > 0 && current.discountRestored === 0;
  if (restore && current.discountCode) {
    await commitWrites(db, [
      restoreDiscountQuery(db, current.discountCode, now),
      db.update(orders).set({ status, discountRestored: 1, updatedAt: now }).where(eq(orders.id, id)),
    ]);
    return { ok: true, updatedAt: now };
  }
  await db.update(orders).set({ status, updatedAt: now }).where(eq(orders.id, id));
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
  const slot = await takeDiscountSlot(db, draft.discountCode, now);
  if (!slot.ok) return { ok: false, status: 409, error: slot.error };
  const snapshot = await snapshotOrderCosts(db, [{ name: draft.productName, productId: draft.productId, quantity: draft.quantity }], draft.totalPrice);
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
          subtotal: draft.subtotal,
          discountCode: draft.discountCode,
          discountAmount: draft.discountAmount,
          discountRestored: 0,
          totalPrice: draft.totalPrice,
          costGoods: snapshot?.costGoods ?? null,
          costExtra: snapshot ? snapshot.costExtra : null,
          costLines: snapshot ? encodeCostLines(snapshot) : null,
          paymentMethod: draft.paymentMethod,
          source: 'web',
          shippingCost: snapshot?.shippingCost ?? 0,
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
  const duplicate = await db
    .select({ createdAt: orders.createdAt })
    .from(orders)
    .where(and(eq(orders.phone, draft.phone), isNull(orders.productId), eq(orders.productName, draft.productName), eq(orders.totalPrice, draft.totalPrice)))
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
    draft.totalPrice,
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
            subtotal: draft.subtotal,
            discountCode: draft.discountCode,
            discountAmount: draft.discountAmount,
            discountRestored: 0,
            totalPrice: draft.totalPrice,
            costGoods: snapshot?.costGoods ?? null,
            costExtra: snapshot ? snapshot.costExtra : null,
            costLines: snapshot ? encodeCostLines(snapshot) : null,
            paymentMethod: draft.paymentMethod,
            source: 'web',
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
  const settled = settleStaffTotal(
    columns.subtotal,
    0,
    flags.compensation ? '' : (draft.orderTotal ?? ''),
    flags.compensation ? '' : (draft.discountExtra ?? ''),
  );
  if (!settled.ok) return settled;
  const collected = applyStaffCollection(settled.totalPrice, settled.discountAmount, null, flags);
  if (!collected.ok) return collected;
  const slot = await takeDiscountSlot(db, collected.discountCode, now);
  if (!slot.ok) return slot;
  const discountCode = collected.discountCode;
  const discountAmount = collected.discountAmount;
  const totalPrice = collected.totalPrice;
  const snapshot = await snapshotOrderCosts(
    db,
    draft.lines.map((line) => ({ name: line.productName, productId: line.productId, quantity: line.quantity })),
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
      const inserted = await db
        .insert(orders)
        .values({
          code,
          customerName: draft.customerName,
          phone: draft.phone,
          address: draft.address,
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
      if (draft.lines.length > 1) {
        try {
          await db.insert(orderItems).values(itemValues(orderId, draft.lines));
        } catch (error) {
          await db.delete(orders).where(eq(orders.id, orderId));
          throw error;
        }
      }
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
  const collected = applyStaffCollection(settled.totalPrice, settled.discountAmount, baseCode, { compensation, shippingFee: current.shippingFee });
  if (!collected.ok) return collected;
  const holdsUse = Boolean(current.discountCode && current.discountAmount > 0 && current.discountRestored === 0);
  const code = collected.discountCode;
  const amount = collected.discountAmount;
  const claim = code ? discount.claim : null;
  const restore = code ? discount.restore : holdsUse;
  const totalPrice = collected.totalPrice;
  const snapshot = await snapshotOrderCosts(
    db,
    lines.map((line) => ({ name: line.productName, productId: line.productId, quantity: line.quantity })),
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
          costGoods: snapshot.costGoods,
          costExtra: snapshot.costExtra,
          costLines: encodeCostLines(snapshot),
          shippingCost: snapshot.shippingCost,
          updatedAt: now,
        })
        .where(eq(orders.id, id)),
      db.delete(orderItems).where(eq(orderItems.orderId, id)),
      ...(lines.length > 1 ? [db.insert(orderItems).values(itemValues(id, lines))] : []),
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
    lineTotal: line.lineTotal,
    sortOrder: index,
  }));
}

export function orderSearchTerm(query: string): { text: string; phone: string } {
  const text = query.replace(/[%_]/g, '').trim().slice(0, 80);
  const digits = text.replace(/\D/g, '');
  if (/^[\d\s.+\-()]+$/.test(text) && digits.length >= 8) return { text: '', phone: normalizePhone(text) ?? digits };
  return { text, phone: '' };
}
