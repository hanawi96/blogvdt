import { asc, eq, sql } from 'drizzle-orm';
import { activityWrite, commitWrites, quotedLabel, type ActivityActor } from '../activity/log';
import { isUniqueViolation } from '../orders/order';
import { parseMaterialPrice } from '../materials/costing';
import { loadProductCosts } from '../materials/recipes';
import type { AppDb } from '../../lib/db/client';
import { orderCosts } from '../../lib/db/schema';
import { isShippingOrderCost } from './shipping-name';

export { isShippingOrderCost };

export const ORDER_COST_NAME_MAX = 80;
export const ORDER_COST_KINDS = ['fixed', 'percent'] as const;
export type OrderCostKind = (typeof ORDER_COST_KINDS)[number];

export type OrderCost = { id: number; name: string; kind: OrderCostKind; value: number; active: boolean };

// Phần vạn: 150 = 1,5%. Chỉ cho phép đến 100%.
const MAX_PERCENT_BP = 10_000;

export function isOrderCostKind(value: string): value is OrderCostKind {
  return (ORDER_COST_KINDS as readonly string[]).includes(value);
}

// "1,5" hoặc "1.5" hoặc "2" (%) -> 150 / 200. Tối đa 2 chữ số thập phân.
export function parsePercentBp(text: string): number | null {
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const bp = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return bp <= MAX_PERCENT_BP ? bp : null;
}

export function formatPercentBp(bp: number): string {
  const whole = Math.floor(bp / 100);
  const frac = bp % 100;
  if (frac === 0) return String(whole);
  return `${whole},${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}

export function parseOrderCostValue(kind: OrderCostKind, text: string): number | null {
  return kind === 'percent' ? parsePercentBp(text) : parseMaterialPrice(text);
}

// Tổng chi phí theo đơn: khoản cố định cộng thẳng, khoản phần trăm tính trên tổng tiền đơn (làm tròn đến đồng).
export function extraCostOf(costs: ReadonlyArray<{ kind: OrderCostKind; value: number }>, orderTotal: number): number {
  return costs.reduce((sum, cost) => sum + (cost.kind === 'percent' ? Math.round((orderTotal * cost.value) / 10_000) : cost.value), 0);
}

// Giá vốn cả đơn = tổng (giá vốn sản phẩm x số lượng). Thiếu công thức ở bất kỳ dòng nào thì chưa biết giá vốn (null).
export function goodsCostOf(
  lines: ReadonlyArray<{ productId: number | null; quantity: number }>,
  costByProduct: ReadonlyMap<number, number>,
): number | null {
  if (lines.length === 0) return null;
  let total = 0;
  for (const line of lines) {
    const unit = line.productId === null ? undefined : costByProduct.get(line.productId);
    if (unit === undefined) return null;
    total += unit * line.quantity;
  }
  return total;
}

export function orderProfit(order: { totalPrice: number; costGoods: number | null; costExtra: number | null; shippingCost?: number | null }): number | null {
  if (order.costGoods === null || order.costExtra === null) return null;
  return order.totalPrice - order.costGoods - order.costExtra - (order.shippingCost ?? 0);
}

// Đơn cũ còn khoản ship nằm trong chi phí đã chụp. Đơn mới lưu riêng ở shipping_cost.
export function orderShippingCost(stored: number, extra: ReadonlyArray<{ name: string; amount: number }> | null | undefined): number {
  if (stored > 0) return stored;
  if (!extra) return 0;
  return extra.reduce((sum, line) => (isShippingOrderCost(line.name) ? sum + line.amount : sum), 0);
}

export type GoodsCostLine = { name: string; quantity: number; unitCost: number; amount: number };
export type ExtraCostLine = { name: string; kind: OrderCostKind; rate: number; amount: number };

// costGoods = null khi còn sản phẩm chưa có công thức: không được bịa tổng giá vốn.
// goods vẫn giữ các dòng đã tính được. extra là các khoản đang bật lúc đặt.
// Phần trăm tính trên số khách phải trả.
export type OrderCostSnapshot = {
  goods: GoodsCostLine[];
  missing: string[];
  extra: ExtraCostLine[];
  costGoods: number | null;
  costExtra: number;
  shippingCost: number;
};

export function costSnapshotOf(
  lines: ReadonlyArray<{ name: string; productId: number | null; quantity: number }>,
  costByProduct: ReadonlyMap<number, number>,
  costs: ReadonlyArray<{ name: string; kind: OrderCostKind; value: number; active: boolean }>,
  payable: number,
): OrderCostSnapshot {
  const missing: string[] = [];
  const goods: GoodsCostLine[] = [];
  for (const line of lines) {
    const unitCost = line.productId === null ? undefined : costByProduct.get(line.productId);
    if (unitCost === undefined) missing.push(line.name);
    else goods.push({ name: line.name, quantity: line.quantity, unitCost, amount: unitCost * line.quantity });
  }
  const known = lines.length > 0 && missing.length === 0;
  const active = costs.filter((cost) => cost.active);
  const lineOf = (cost: (typeof active)[number]): ExtraCostLine => ({
    name: cost.name,
    kind: cost.kind,
    rate: cost.value,
    amount: cost.kind === 'percent' ? Math.round((payable * cost.value) / 10_000) : cost.value,
  });
  const shipping = active.filter((cost) => isShippingOrderCost(cost.name)).map(lineOf);
  const extra = active.filter((cost) => !isShippingOrderCost(cost.name)).map(lineOf);
  return {
    goods,
    missing,
    extra,
    costGoods: known ? goods.reduce((sum, line) => sum + line.amount, 0) : null,
    costExtra: extra.reduce((sum, line) => sum + line.amount, 0),
    shippingCost: shipping.reduce((sum, line) => sum + line.amount, 0),
  };
}

export function encodeCostLines(snapshot: Pick<OrderCostSnapshot, 'goods' | 'missing' | 'extra'>): string {
  return JSON.stringify({ goods: snapshot.goods, missing: snapshot.missing, extra: snapshot.extra });
}

function readMoney(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 99_999_999 ? value : null;
}

export function parseCostLines(raw: string | null): Pick<OrderCostSnapshot, 'goods' | 'missing' | 'extra'> | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as { goods?: unknown; missing?: unknown; extra?: unknown };
  const missing = Array.isArray(record.missing) && record.missing.every((name) => typeof name === 'string') ? record.missing : null;
  if (!missing) return null;
  if (!Array.isArray(record.goods)) return null;
  const goods: GoodsCostLine[] = [];
  for (const line of record.goods) {
    if (!line || typeof line !== 'object') return null;
    const item = line as { name?: unknown; quantity?: unknown; unitCost?: unknown; amount?: unknown };
    const unitCost = readMoney(item.unitCost);
    const amount = readMoney(item.amount);
    if (typeof item.name !== 'string' || typeof item.quantity !== 'number' || !Number.isInteger(item.quantity) || item.quantity < 1 || unitCost === null || amount === null) {
      return null;
    }
    goods.push({ name: item.name, quantity: item.quantity, unitCost, amount });
  }
  if (!Array.isArray(record.extra)) return null;
  const extra: ExtraCostLine[] = [];
  for (const line of record.extra) {
    if (!line || typeof line !== 'object') return null;
    const item = line as { name?: unknown; kind?: unknown; rate?: unknown; amount?: unknown };
    const rate = readMoney(item.rate);
    const amount = readMoney(item.amount);
    if (typeof item.name !== 'string' || (item.kind !== 'fixed' && item.kind !== 'percent') || rate === null || amount === null) return null;
    extra.push({ name: item.name, kind: item.kind, rate, amount });
  }
  return { goods, missing, extra };
}

export async function listOrderCosts(db: AppDb): Promise<OrderCost[]> {
  const rows = await db
    .select({ id: orderCosts.id, name: orderCosts.name, kind: orderCosts.kind, value: orderCosts.value, active: orderCosts.active })
    .from(orderCosts)
    .orderBy(asc(orderCosts.sortOrder), asc(orderCosts.id));
  return rows.flatMap((row) => (isOrderCostKind(row.kind) ? [{ ...row, kind: row.kind, active: row.active === 1 }] : []));
}

// Chụp chi phí tại thời điểm đặt đơn. Lỗi đọc chi phí không được làm mất đơn của khách: trả null, đơn vẫn lưu.
export async function snapshotOrderCosts(
  db: AppDb,
  lines: ReadonlyArray<{ name: string; productId: number | null; quantity: number }>,
  payable: number,
): Promise<OrderCostSnapshot | null> {
  try {
    const [costs, byProduct] = await Promise.all([listOrderCosts(db), loadProductCosts(db)]);
    return costSnapshotOf(lines, byProduct, costs, payable);
  } catch (error) {
    console.error(JSON.stringify({ event: 'order_cost_snapshot_failed', name: error instanceof Error ? error.name : 'unknown' }));
    return null;
  }
}

export type OrderCostInput = { id?: number; name: string; kind: string; value: string; active: boolean };

export async function saveOrderCost(
  db: AppDb,
  input: OrderCostInput,
  now = Date.now(),
  actor?: ActivityActor,
): Promise<{ ok: true; cost: OrderCost } | { ok: false; error: string }> {
  const name = input.name.replace(/\s+/g, ' ').trim();
  if (!name) return { ok: false, error: 'Nhập tên chi phí.' };
  if (name.length > ORDER_COST_NAME_MAX) return { ok: false, error: 'Tên chi phí quá dài.' };
  if (!isOrderCostKind(input.kind)) return { ok: false, error: 'Chọn cách tính chi phí.' };
  const value = parseOrderCostValue(input.kind, input.value);
  if (value === null) {
    return { ok: false, error: input.kind === 'percent' ? 'Phần trăm từ 0 đến 100, tối đa 2 số lẻ.' : 'Số tiền là số nguyên VND, từ 0 đến 99.999.999.' };
  }
  const taken = await db.select({ id: orderCosts.id }).from(orderCosts).where(sql`lower(${orderCosts.name}) = ${name.toLowerCase()}`).limit(1);
  if (taken[0] && taken[0].id !== (input.id ?? null)) return { ok: false, error: 'Tên chi phí đã tồn tại.' };
  const active = input.active ? 1 : 0;
  try {
    if (input.id) {
      const rows = await db.select({ id: orderCosts.id }).from(orderCosts).where(eq(orderCosts.id, input.id)).limit(1);
      if (!rows[0]) return { ok: false, error: 'Không tìm thấy chi phí.' };
      await commitWrites(db, [
        db.update(orderCosts).set({ name, kind: input.kind, value, active, updatedAt: now }).where(eq(orderCosts.id, input.id)),
        ...(actor
          ? [
              activityWrite(
                db,
                {
                  actorId: actor.id,
                  actorName: actor.name,
                  action: 'order_cost.update',
                  objectType: 'order_cost',
                  objectId: String(input.id),
                  summary: `Đã cập nhật chi phí theo đơn “${quotedLabel(name, 'Không tên')}”.`,
                  createdAt: now,
                },
                true,
              ),
            ]
          : []),
      ]);
      return { ok: true, cost: { id: input.id, name, kind: input.kind, value, active: input.active } };
    }
    await commitWrites(db, [
      db.insert(orderCosts).values({ name, kind: input.kind, value, active, sortOrder: 0, createdAt: now, updatedAt: now }),
      ...(actor
        ? [
            activityWrite(
              db,
              {
                actorId: actor.id,
                actorName: actor.name,
                action: 'order_cost.create',
                objectType: 'order_cost',
                objectId: null,
                summary: `Đã tạo chi phí theo đơn “${quotedLabel(name, 'Không tên')}”.`,
                createdAt: now,
                useLastInsertId: true,
              },
              true,
            ),
          ]
        : []),
    ]);
    const created = await db
      .select({ id: orderCosts.id, name: orderCosts.name, kind: orderCosts.kind, value: orderCosts.value, active: orderCosts.active })
      .from(orderCosts)
      .where(sql`lower(${orderCosts.name}) = ${name.toLowerCase()}`)
      .limit(1);
    const row = created[0];
    if (!row) return { ok: false, error: 'Chưa lưu được chi phí.' };
    return { ok: true, cost: { id: row.id, name: row.name, kind: row.kind as OrderCostKind, value: row.value, active: row.active === 1 } };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: 'Tên chi phí đã tồn tại.' };
    throw error;
  }
}

export async function deleteOrderCost(
  db: AppDb,
  id: number,
  actor?: ActivityActor,
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rows = await db.select({ name: orderCosts.name }).from(orderCosts).where(eq(orderCosts.id, id)).limit(1);
  const current = rows[0];
  if (!current) return { ok: false, error: 'Không tìm thấy chi phí.' };
  await commitWrites(db, [
    db.delete(orderCosts).where(eq(orderCosts.id, id)),
    ...(actor
      ? [
          activityWrite(
            db,
            {
              actorId: actor.id,
              actorName: actor.name,
              action: 'order_cost.delete',
              objectType: 'order_cost',
              objectId: String(id),
              summary: `Đã xóa chi phí theo đơn “${quotedLabel(current.name, 'Không tên')}”.`,
              createdAt: now,
            },
            true,
          ),
        ]
      : []),
  ]);
  return { ok: true };
}
