import { desc, eq } from 'drizzle-orm';
import { activityWrite, commitWrites, type ActivityActor } from '../activity/log';
import { parseMaterialPrice } from '../materials/costing';
import { orderDayKey } from '../orders/order';
import type { AppDb } from '../../lib/db/client';
import { adSpend } from '../../lib/db/schema';
import { formatVnd } from '../../lib/money';

export const AD_KINDS = ['rate', 'day'] as const;
export type AdKind = (typeof AD_KINDS)[number];
export type AdRow = { id: number; kind: AdKind; day: string; amount: number };

const DAY_MS = 24 * 60 * 60 * 1000;
const LIST_LIMIT = 60;

export function isAdKind(value: string): value is AdKind {
  return (AD_KINDS as readonly string[]).includes(value);
}

// Ngày theo giờ Việt Nam dạng YYYY-MM-DD (cùng múi giờ với mã đơn).
export function adDayKey(now: number): string {
  const key = orderDayKey(now);
  return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
}

// Chỉ nhận ngày có thật trên lịch (không có 2026-02-31).
export function parseAdDay(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return valid && year >= 2020 && year <= 2100 ? match[0] : null;
}

// `count` ngày gần nhất tính cả hôm nay; offset = số ngày lùi thêm (dùng cho kỳ trước).
export function recentDayKeys(now: number, count: number, offset = 0): string[] {
  return Array.from({ length: count }, (_, index) => adDayKey(now - (index + offset) * DAY_MS));
}

// Mỗi ngày: số riêng của ngày đó nếu có, nếu không thì mức chung có hiệu lực gần nhất trước hoặc đúng ngày đó, nếu không có thì 0.
export function adSpendFor(days: readonly string[], rows: ReadonlyArray<Pick<AdRow, 'kind' | 'day' | 'amount'>>): number {
  const overrides = new Map(rows.filter((row) => row.kind === 'day').map((row) => [row.day, row.amount]));
  const rates = rows.filter((row) => row.kind === 'rate').sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  let total = 0;
  for (const day of days) {
    const own = overrides.get(day);
    if (own !== undefined) {
      total += own;
      continue;
    }
    let rate = 0;
    for (const item of rates) {
      if (item.day > day) break;
      rate = item.amount;
    }
    total += rate;
  }
  return total;
}

async function loadAllRows(db: AppDb): Promise<AdRow[]> {
  const rows = await db.select({ id: adSpend.id, kind: adSpend.kind, day: adSpend.day, amount: adSpend.amount }).from(adSpend);
  return rows.flatMap((row) => (isAdKind(row.kind) ? [{ ...row, kind: row.kind }] : []));
}

// Tổng quảng cáo của kỳ hiện tại và kỳ liền trước (mỗi kỳ `days` ngày).
export async function adTotals(db: AppDb, now: number, days: number): Promise<{ current: number; previous: number }> {
  const rows = await loadAllRows(db);
  return { current: adSpendFor(recentDayKeys(now, days), rows), previous: adSpendFor(recentDayKeys(now, days, days), rows) };
}

export async function listAdSpend(db: AppDb): Promise<AdRow[]> {
  const rows = await db
    .select({ id: adSpend.id, kind: adSpend.kind, day: adSpend.day, amount: adSpend.amount })
    .from(adSpend)
    .orderBy(desc(adSpend.day), desc(adSpend.id))
    .limit(LIST_LIMIT);
  return rows.flatMap((row) => (isAdKind(row.kind) ? [{ ...row, kind: row.kind }] : []));
}

export async function saveAdSpend(
  db: AppDb,
  input: { kind: string; day: string; amount: string },
  now = Date.now(),
  actor?: ActivityActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isAdKind(input.kind)) return { ok: false, error: 'Chọn cách áp dụng.' };
  const day = parseAdDay(input.day);
  if (!day) return { ok: false, error: 'Chọn một ngày hợp lệ.' };
  const amount = parseMaterialPrice(input.amount);
  if (amount === null) return { ok: false, error: 'Số tiền là số nguyên VND, từ 0 đến 99.999.999.' };
  const label = input.kind === 'rate' ? `mức mỗi ngày từ ${day}` : `ngày ${day}`;
  await commitWrites(db, [
    db
      .insert(adSpend)
      .values({ kind: input.kind, day, amount, updatedAt: now })
      .onConflictDoUpdate({ target: [adSpend.kind, adSpend.day], set: { amount, updatedAt: now } }),
    ...(actor
      ? [
          activityWrite(
            db,
            {
              actorId: actor.id,
              actorName: actor.name,
              action: 'ad_spend.save',
              objectType: 'ad_spend',
              objectId: null,
              summary: `Đặt chi phí quảng cáo ${label}: ${formatVnd(amount)}.`,
              createdAt: now,
            },
            true,
          ),
        ]
      : []),
  ]);
  return { ok: true };
}

export async function deleteAdSpend(
  db: AppDb,
  id: number,
  actor?: ActivityActor,
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rows = await db.select({ kind: adSpend.kind, day: adSpend.day }).from(adSpend).where(eq(adSpend.id, id)).limit(1);
  const current = rows[0];
  if (!current) return { ok: false, error: 'Không tìm thấy mục quảng cáo.' };
  await commitWrites(db, [
    db.delete(adSpend).where(eq(adSpend.id, id)),
    ...(actor
      ? [
          activityWrite(
            db,
            {
              actorId: actor.id,
              actorName: actor.name,
              action: 'ad_spend.delete',
              objectType: 'ad_spend',
              objectId: String(id),
              summary: `Đã xóa chi phí quảng cáo ${current.kind === 'rate' ? 'mức mỗi ngày từ' : 'ngày'} ${current.day}.`,
              createdAt: now,
            },
            true,
          ),
        ]
      : []),
  ]);
  return { ok: true };
}
