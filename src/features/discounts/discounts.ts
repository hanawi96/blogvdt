import { and, asc, desc, eq, gt, isNull, like, lt, lte, or, sql } from 'drizzle-orm';
import { activityWrite, commitWrites, quotedLabel, type ActivityActor } from '../activity/log';
import { isUniqueViolation } from '../orders/order';
import { parseMaterialPrice } from '../materials/costing';
import type { AppDb } from '../../lib/db/client';
import { discountChecks, discountCodes } from '../../lib/db/schema';
import {
  DISCOUNT_CODE_MAX,
  DISCOUNT_FIXED_MIN,
  DISCOUNT_PERCENT_MAX,
  formatDiscountTime,
  isDiscountKind,
  normalizeDiscountCode,
  parseDiscountTime,
  quoteDiscount,
  type DiscountKind,
  type DiscountQuote,
  type DiscountRule,
} from './quote';

export const DISCOUNT_CHECK_LIMIT = 20;
export const DISCOUNT_CHECK_WINDOW_MS = 10 * 60 * 1000;
export const DISCOUNT_NOTE_MAX = 200;
const LIST_LIMIT = 100;

export type DiscountCode = DiscountRule & {
  id: number;
  note: string;
  createdAt: number;
  updatedAt: number;
};

type DiscountRow = {
  id: number;
  code: string;
  kind: string;
  value: number;
  minSubtotal: number;
  usageLimit: number | null;
  usedCount: number;
  startsAt: number | null;
  endsAt: number | null;
  active: number;
  note: string | null;
  createdAt: number;
  updatedAt: number;
};

function toCode(row: DiscountRow): DiscountCode | null {
  if (!isDiscountKind(row.kind)) return null;
  return {
    id: row.id,
    code: row.code,
    kind: row.kind,
    value: row.value,
    minSubtotal: row.minSubtotal,
    usageLimit: row.usageLimit,
    usedCount: row.usedCount,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    active: row.active === 1,
    note: row.note ?? '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const codeColumns = {
  id: discountCodes.id,
  code: discountCodes.code,
  kind: discountCodes.kind,
  value: discountCodes.value,
  minSubtotal: discountCodes.minSubtotal,
  usageLimit: discountCodes.usageLimit,
  usedCount: discountCodes.usedCount,
  startsAt: discountCodes.startsAt,
  endsAt: discountCodes.endsAt,
  active: discountCodes.active,
  note: discountCodes.note,
  createdAt: discountCodes.createdAt,
  updatedAt: discountCodes.updatedAt,
};

export async function listDiscountCodes(db: AppDb, query: string): Promise<DiscountCode[]> {
  const term = query.replace(/[%_]/g, '').trim().toUpperCase().slice(0, 20);
  const where = term ? like(discountCodes.code, `%${term}%`) : undefined;
  const rows = await db.select(codeColumns).from(discountCodes).where(where).orderBy(desc(discountCodes.updatedAt), desc(discountCodes.id)).limit(LIST_LIMIT);
  return rows.flatMap((row) => {
    const code = toCode(row);
    return code ? [code] : [];
  });
}

export async function getDiscountCode(db: AppDb, id: number): Promise<DiscountCode | null> {
  const rows = await db.select(codeColumns).from(discountCodes).where(eq(discountCodes.id, id)).limit(1);
  const row = rows[0];
  return row ? toCode(row) : null;
}

export type DiscountInput = {
  id?: number;
  code: string;
  kind: string;
  value: string;
  minSubtotal: string;
  usageLimit: string;
  startsAt: string;
  endsAt: string;
  active: boolean;
  note: string;
};

export type DiscountDraft = {
  code: string;
  kind: DiscountKind;
  value: number;
  minSubtotal: number;
  usageLimit: number | null;
  startsAt: number | null;
  endsAt: number | null;
  active: boolean;
  note: string | null;
};

export function readDiscountInput(input: DiscountInput): { ok: true; draft: DiscountDraft } | { ok: false; error: string } {
  const typed = input.code.trim();
  if (!typed) return { ok: false, error: 'Nhập mã giảm giá.' };
  if (/[^A-Za-z0-9]/.test(typed)) return { ok: false, error: 'Mã chỉ gồm chữ và số, không khoảng trắng hay ký tự đặc biệt.' };
  const code = typed.toUpperCase();
  if (code.length < 3 || code.length > DISCOUNT_CODE_MAX) return { ok: false, error: 'Mã từ 3 đến 20 ký tự.' };
  if (!isDiscountKind(input.kind)) return { ok: false, error: 'Chọn cách giảm.' };
  const valueText = input.value.trim();
  const value = input.kind === 'percent' ? parsePercent(valueText) : parseFixed(valueText);
  if (value === null) {
    return {
      ok: false,
      error: input.kind === 'percent' ? `Phần trăm là số nguyên từ 1 đến ${DISCOUNT_PERCENT_MAX}.` : 'Số tiền là số nguyên VND, từ 1.000 đến 99.999.999.',
    };
  }
  const minText = input.minSubtotal.trim();
  const minSubtotal = minText ? parseMaterialPrice(minText) : 0;
  if (minSubtotal === null) return { ok: false, error: 'Đơn tối thiểu là số tiền VND, hoặc để trống.' };
  const limitText = input.usageLimit.trim();
  let usageLimit: number | null = null;
  if (limitText) {
    if (!/^\d{1,6}$/.test(limitText) || Number(limitText) < 1) return { ok: false, error: 'Giới hạn lượt là số nguyên từ 1, hoặc để trống.' };
    usageLimit = Number(limitText);
  }
  const startsText = input.startsAt.trim();
  const endsText = input.endsAt.trim();
  const startsAt = startsText ? parseDiscountTime(startsText) : null;
  const endsAt = endsText ? parseDiscountTime(endsText) : null;
  if ((startsText && startsAt === null) || (endsText && endsAt === null)) return { ok: false, error: 'Thời gian chưa đúng.' };
  if (startsAt !== null && endsAt !== null && endsAt <= startsAt) return { ok: false, error: 'Thời điểm kết thúc phải sau thời điểm bắt đầu.' };
  const note = input.note.replace(/\s+/g, ' ').trim();
  if (note.length > DISCOUNT_NOTE_MAX) return { ok: false, error: 'Ghi chú tối đa 200 ký tự.' };
  return {
    ok: true,
    draft: { code, kind: input.kind, value, minSubtotal, usageLimit, startsAt, endsAt, active: input.active, note: note || null },
  };
}

function parsePercent(text: string): number | null {
  if (!/^\d{1,2}$/.test(text)) return null;
  const value = Number(text);
  return value >= 1 && value <= DISCOUNT_PERCENT_MAX ? value : null;
}

function parseFixed(text: string): number | null {
  const value = parseMaterialPrice(text);
  return value !== null && value >= DISCOUNT_FIXED_MIN ? value : null;
}

export function discountFormValue(code: DiscountCode): DiscountInput {
  return {
    id: code.id,
    code: code.code,
    kind: code.kind,
    value: String(code.value),
    minSubtotal: code.minSubtotal > 0 ? String(code.minSubtotal) : '',
    usageLimit: code.usageLimit === null ? '' : String(code.usageLimit),
    startsAt: code.startsAt === null ? '' : formatDiscountTime(code.startsAt),
    endsAt: code.endsAt === null ? '' : formatDiscountTime(code.endsAt),
    active: code.active,
    note: code.note,
  };
}

export async function saveDiscountCode(
  db: AppDb,
  input: DiscountInput,
  now = Date.now(),
  actor?: ActivityActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = readDiscountInput(input);
  if (!parsed.ok) return parsed;
  const draft = parsed.draft;
  const current = input.id ? await getDiscountCode(db, input.id) : null;
  if (input.id && !current) return { ok: false, error: 'Không tìm thấy mã giảm giá.' };
  if (current && current.usedCount > 0 && current.code !== draft.code) {
    return { ok: false, error: 'Mã đã có đơn dùng, không đổi được mã. Hãy tắt mã này và tạo mã mới.' };
  }
  if (current && draft.usageLimit !== null && draft.usageLimit < current.usedCount) {
    return { ok: false, error: 'Giới hạn lượt không được nhỏ hơn số lượt đã dùng.' };
  }
  const values = {
    code: draft.code,
    kind: draft.kind,
    value: draft.value,
    minSubtotal: draft.minSubtotal,
    usageLimit: draft.usageLimit,
    startsAt: draft.startsAt,
    endsAt: draft.endsAt,
    active: draft.active ? 1 : 0,
    note: draft.note,
    updatedAt: now,
  };
  try {
    if (current) {
      await commitWrites(db, [
        db.update(discountCodes).set(values).where(eq(discountCodes.id, current.id)),
        ...(actor
          ? [
              activityWrite(
                db,
                {
                  actorId: actor.id,
                  actorName: actor.name,
                  action: 'discount.update',
                  objectType: 'discount',
                  objectId: String(current.id),
                  summary: `Đã cập nhật mã giảm giá “${quotedLabel(draft.code, 'Không mã')}”.`,
                  createdAt: now,
                },
                true,
              ),
            ]
          : []),
      ]);
      return { ok: true };
    }
    await commitWrites(db, [
      db.insert(discountCodes).values({ ...values, usedCount: 0, createdAt: now }),
      ...(actor
        ? [
            activityWrite(
              db,
              {
                actorId: actor.id,
                actorName: actor.name,
                action: 'discount.create',
                objectType: 'discount',
                objectId: null,
                summary: `Đã tạo mã giảm giá “${quotedLabel(draft.code, 'Không mã')}”.`,
                createdAt: now,
                useLastInsertId: true,
              },
              true,
            ),
          ]
        : []),
    ]);
    return { ok: true };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: 'Mã này đã tồn tại.' };
    throw error;
  }
}

export async function setDiscountActive(
  db: AppDb,
  id: number,
  active: boolean,
  now = Date.now(),
  actor?: ActivityActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const current = await getDiscountCode(db, id);
  if (!current) return { ok: false, error: 'Không tìm thấy mã giảm giá.' };
  const next = active ? 1 : 0;
  if ((current.active ? 1 : 0) === next) return { ok: true };
  await commitWrites(db, [
    db.update(discountCodes).set({ active: next, updatedAt: now }).where(eq(discountCodes.id, id)),
    ...(actor
      ? [
          activityWrite(
            db,
            {
              actorId: actor.id,
              actorName: actor.name,
              action: 'discount.update',
              objectType: 'discount',
              objectId: String(id),
              summary: `${active ? 'Đã bật' : 'Đã tắt'} mã giảm giá “${quotedLabel(current.code, 'Không mã')}”.`,
              createdAt: now,
            },
            true,
          ),
        ]
      : []),
  ]);
  return { ok: true };
}

export async function deleteDiscountCode(
  db: AppDb,
  id: number,
  actor?: ActivityActor,
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const current = await getDiscountCode(db, id);
  if (!current) return { ok: false, error: 'Không tìm thấy mã giảm giá.' };
  if (current.usedCount > 0) return { ok: false, error: 'Mã đã được dùng. Hãy tắt thay vì xóa, để đơn cũ vẫn giữ đúng mã.' };
  await commitWrites(db, [
    db.delete(discountCodes).where(eq(discountCodes.id, id)),
    ...(actor
      ? [
          activityWrite(
            db,
            {
              actorId: actor.id,
              actorName: actor.name,
              action: 'discount.delete',
              objectType: 'discount',
              objectId: String(id),
              summary: `Đã xóa mã giảm giá “${quotedLabel(current.code, 'Không mã')}”.`,
              createdAt: now,
            },
            true,
          ),
        ]
      : []),
  ]);
  return { ok: true };
}

// Điều kiện trừ lượt phải khớp discountBlockReason: đang bật, còn hạn, còn lượt.
export async function claimDiscount(db: AppDb, code: string, now: number): Promise<number | null> {
  const rows = await db
    .update(discountCodes)
    .set({ usedCount: sql`${discountCodes.usedCount} + 1`, updatedAt: now })
    .where(
      and(
        eq(discountCodes.code, code),
        eq(discountCodes.active, 1),
        or(isNull(discountCodes.usageLimit), lt(discountCodes.usedCount, discountCodes.usageLimit)),
        or(isNull(discountCodes.startsAt), lte(discountCodes.startsAt, now)),
        or(isNull(discountCodes.endsAt), gt(discountCodes.endsAt, now)),
      ),
    )
    .returning({ id: discountCodes.id });
  return rows[0]?.id ?? null;
}

export async function releaseDiscount(db: AppDb, id: number, now: number): Promise<void> {
  await db
    .update(discountCodes)
    .set({ usedCount: sql`${discountCodes.usedCount} - 1`, updatedAt: now })
    .where(and(eq(discountCodes.id, id), gt(discountCodes.usedCount, 0)));
}

export function restoreDiscountQuery(db: AppDb, code: string, now: number) {
  return db
    .update(discountCodes)
    .set({ usedCount: sql`${discountCodes.usedCount} - 1`, updatedAt: now })
    .where(and(eq(discountCodes.code, code), gt(discountCodes.usedCount, 0)));
}

async function allowDiscountCheck(db: AppDb, ipHash: string, now: number): Promise<boolean> {
  const rows = await db
    .select({ windowStart: discountChecks.windowStart, hits: discountChecks.hits })
    .from(discountChecks)
    .where(eq(discountChecks.ipHash, ipHash))
    .limit(1);
  const current = rows[0];
  if (!current || now - current.windowStart >= DISCOUNT_CHECK_WINDOW_MS) {
    await db
      .insert(discountChecks)
      .values({ ipHash, windowStart: now, hits: 1 })
      .onConflictDoUpdate({ target: discountChecks.ipHash, set: { windowStart: now, hits: 1 } });
    return true;
  }
  if (current.hits >= DISCOUNT_CHECK_LIMIT) return false;
  await db
    .update(discountChecks)
    .set({ hits: current.hits + 1 })
    .where(and(eq(discountChecks.ipHash, ipHash), eq(discountChecks.windowStart, current.windowStart)));
  return true;
}

export type StaffDiscountChoice = {
  code: string;
  kind: DiscountKind;
  value: number;
  minSubtotal: number;
};

// Mã đang bật, còn hạn và còn lượt. Trang nhập đơn nhúng danh sách này, không gọi thêm khi chọn.
export async function listStaffDiscountChoices(db: AppDb, now = Date.now()): Promise<StaffDiscountChoice[]> {
  const rows = await db
    .select({
      code: discountCodes.code,
      kind: discountCodes.kind,
      value: discountCodes.value,
      minSubtotal: discountCodes.minSubtotal,
    })
    .from(discountCodes)
    .where(
      and(
        eq(discountCodes.active, 1),
        or(isNull(discountCodes.startsAt), lte(discountCodes.startsAt, now)),
        or(isNull(discountCodes.endsAt), gt(discountCodes.endsAt, now)),
        or(isNull(discountCodes.usageLimit), lt(discountCodes.usedCount, discountCodes.usageLimit)),
      ),
    )
    .orderBy(asc(discountCodes.code))
    .limit(100);
  return rows.flatMap((row) => (isDiscountKind(row.kind) ? [{ code: row.code, kind: row.kind, value: row.value, minSubtotal: row.minSubtotal }] : []));
}

// Nhân viên chọn mã trong danh sách, không bị khóa theo IP như khách thử mã trên trang công khai.
export async function quoteStaffDiscount(
  db: AppDb,
  subtotal: number,
  rawCode: string,
  now = Date.now(),
): Promise<{ ok: true; discount: DiscountQuote | null } | { ok: false; error: string }> {
  if (!rawCode.trim()) return { ok: true, discount: null };
  const code = normalizeDiscountCode(rawCode);
  if (!code) return { ok: false, error: 'Mã giảm giá không hợp lệ.' };
  const rows = await db.select(codeColumns).from(discountCodes).where(eq(discountCodes.code, code)).limit(1);
  const quoted = quoteDiscount(rows[0] ? toCode(rows[0]) : null, subtotal, now);
  if (!quoted.ok) return quoted;
  return { ok: true, discount: quoted.quote };
}

export async function priceDiscount(
  db: AppDb,
  subtotal: number,
  rawCode: string,
  ipHash: string,
  now = Date.now(),
  required = false,
): Promise<{ ok: true; discount: DiscountQuote | null } | { ok: false; error: string }> {
  if (!rawCode.trim()) return required ? { ok: false, error: 'Nhập mã giảm giá.' } : { ok: true, discount: null };
  if (!(await allowDiscountCheck(db, ipHash, now))) {
    return { ok: false, error: 'Bạn thử mã quá nhiều lần. Đợi vài phút rồi thử lại.' };
  }
  const code = normalizeDiscountCode(rawCode);
  if (!code) return { ok: false, error: 'Mã gồm 3 đến 20 ký tự chữ hoặc số.' };
  const rows = await db.select(codeColumns).from(discountCodes).where(eq(discountCodes.code, code)).limit(1);
  const found = rows[0] ? toCode(rows[0]) : null;
  const quoted = quoteDiscount(found, subtotal, now);
  if (!quoted.ok) return quoted;
  return { ok: true, discount: quoted.quote };
}
