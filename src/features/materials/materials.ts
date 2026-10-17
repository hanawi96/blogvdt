import { asc, count, eq, sql } from 'drizzle-orm';
import { activityWrite, commitWrites, pageWindow, quotedLabel, type ActivityActor } from '../activity/log';
import { isUniqueViolation } from '../orders/order';
import { slugify } from '../posts/slug';
import type { AppDb } from '../../lib/db/client';
import { materialGroups, materials, productMaterials } from '../../lib/db/schema';
import { formatVnd } from '../../lib/money';
import { parseMaterialPrice } from './costing';
import { listGroups } from './groups';

export const MATERIAL_PAGE_SIZE = 100;
export { MATERIAL_MAX_PRICE, parseMaterialPrice } from './costing';

const NAME_MAX = 120;
const CODE_MAX = 60;
const CODE_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const CODE_TRIES = 30;

export type MaterialInput = {
  id?: number;
  name: string;
  code: string;
  groupId: number;
  unitCost: string;
  active: boolean;
};

export type ParsedMaterial = { name: string; code: string; groupId: number; unitCost: number; active: boolean };

export function deriveMaterialCode(name: string): string {
  return slugify(name).replace(/-/g, '_').slice(0, CODE_MAX).replace(/_+$/, '');
}

// checkCode = false khi sửa: mã không đổi sau khi tạo nên giá trị gửi lên bị bỏ qua, không cần kiểm tra.
export function parseMaterialInput(
  input: MaterialInput,
  checkCode = true,
): { ok: true; value: ParsedMaterial } | { ok: false; error: string } {
  const name = input.name.replace(/\s+/g, ' ').trim();
  const code = input.code.trim().toLowerCase();
  const unitCost = parseMaterialPrice(input.unitCost);
  if (!name) return { ok: false, error: 'Nhập tên nguyên liệu.' };
  if (name.length > NAME_MAX) return { ok: false, error: 'Tên nguyên liệu quá dài.' };
  if (!Number.isSafeInteger(input.groupId) || input.groupId <= 0) return { ok: false, error: 'Chọn nhóm nguyên liệu.' };
  if (unitCost === null) return { ok: false, error: 'Đơn giá là số nguyên VND, từ 0 đến 99.999.999.' };
  if (checkCode && code && (code.length > CODE_MAX || !CODE_PATTERN.test(code))) {
    return { ok: false, error: 'Mã chỉ gồm chữ thường, số và dấu gạch dưới.' };
  }
  return { ok: true, value: { name, code, groupId: input.groupId, unitCost, active: input.active } };
}

export function materialChangeSummary(name: string, before: { unitCost: number; active: boolean } | null, after: { unitCost: number; active: boolean }): string {
  const label = quotedLabel(name, 'Không tên');
  if (!before) return `Đã tạo nguyên liệu “${label}” (${formatVnd(after.unitCost)}).`;
  if (before.unitCost !== after.unitCost) {
    const verb = after.unitCost > before.unitCost ? 'lên' : 'xuống';
    return `Đổi giá “${label}” từ ${formatVnd(before.unitCost)} ${verb} ${formatVnd(after.unitCost)}.`;
  }
  if (before.active !== after.active) return `${after.active ? 'Dùng lại' : 'Ngừng dùng'} nguyên liệu “${label}”.`;
  return `Đã cập nhật nguyên liệu “${label}”.`;
}

export function materialInUseError(used: number): string | null {
  if (used <= 0) return null;
  return `Nguyên liệu đang được ${used} sản phẩm dùng, chưa xóa được. Hãy chuyển sang ngừng dùng.`;
}

export async function listMaterials(db: AppDb, filters: { groupId: number | null; page: number }) {
  const where = filters.groupId ? eq(materials.groupId, filters.groupId) : undefined;
  const [totalRows, groups, libraryRows] = await Promise.all([
    db.select({ value: count() }).from(materials).where(where),
    listGroups(db),
    db.select({ value: count() }).from(materials),
  ]);
  const total = totalRows[0]?.value ?? 0;
  const window = pageWindow(total, filters.page, MATERIAL_PAGE_SIZE);
  const rows = await db
    .select({
      id: materials.id,
      code: materials.code,
      name: materials.name,
      groupId: materials.groupId,
      group: sql<string>`coalesce(${materialGroups.name}, 'Chưa phân nhóm')`.mapWith(String),
      unitCost: materials.unitCost,
      active: materials.active,
      updatedAt: materials.updatedAt,
      usedBy: sql<number>`(select count(*) from product_materials pm where pm.material_id = "materials"."id")`.mapWith(Number),
    })
    .from(materials)
    .leftJoin(materialGroups, eq(materials.groupId, materialGroups.id))
    .where(where)
    .orderBy(asc(sql`coalesce(${materialGroups.sortOrder}, 2147483647)`), asc(materials.name), asc(materials.id))
    .limit(MATERIAL_PAGE_SIZE)
    .offset(window.offset);
  return {
    rows: rows.map((row) => ({ ...row, active: row.active === 1 })),
    total,
    page: window.current,
    pageCount: window.pageCount,
    groups,
    libraryTotal: libraryRows[0]?.value ?? 0,
  };
}

async function nameTaken(db: AppDb, name: string, exceptId: number | null): Promise<boolean> {
  const rows = await db
    .select({ id: materials.id })
    .from(materials)
    .where(sql`lower(${materials.name}) = ${name.toLowerCase()}`)
    .limit(1);
  const found = rows[0];
  return Boolean(found) && found?.id !== exceptId;
}

async function codeTaken(db: AppDb, code: string): Promise<boolean> {
  const rows = await db.select({ id: materials.id }).from(materials).where(eq(materials.code, code)).limit(1);
  return rows.length > 0;
}

async function freeCode(db: AppDb, base: string): Promise<string | null> {
  const root = base || 'nguyen_lieu';
  for (let attempt = 1; attempt <= CODE_TRIES; attempt += 1) {
    const candidate = attempt === 1 ? root : `${root.slice(0, CODE_MAX - 4)}_${attempt}`;
    if (!(await codeTaken(db, candidate))) return candidate;
  }
  return null;
}

export async function saveMaterial(
  db: AppDb,
  input: MaterialInput,
  now = Date.now(),
  actor?: ActivityActor,
): Promise<{ ok: true; priceChanged: boolean } | { ok: false; error: string }> {
  const parsed = parseMaterialInput(input, !input.id);
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  const groupRows = await db.select({ id: materialGroups.id }).from(materialGroups).where(eq(materialGroups.id, value.groupId)).limit(1);
  if (groupRows.length === 0) return { ok: false, error: 'Chọn nhóm nguyên liệu.' };
  if (await nameTaken(db, value.name, input.id ?? null)) return { ok: false, error: 'Tên nguyên liệu đã tồn tại.' };

  if (input.id) {
    const rows = await db
      .select({ unitCost: materials.unitCost, active: materials.active, name: materials.name, groupId: materials.groupId })
      .from(materials)
      .where(eq(materials.id, input.id))
      .limit(1);
    const current = rows[0];
    if (!current) return { ok: false, error: 'Không tìm thấy nguyên liệu.' };
    const active = value.active ? 1 : 0;
    if (current.name === value.name && current.groupId === value.groupId && current.unitCost === value.unitCost && current.active === active) {
      return { ok: true, priceChanged: false };
    }
    // Mã không đổi sau khi tạo để các nơi tham chiếu (nhập file, công thức) không bị lệch.
    await commitWrites(db, [
      db
        .update(materials)
        .set({ name: value.name, groupId: value.groupId, unitCost: value.unitCost, active, updatedAt: now })
        .where(eq(materials.id, input.id)),
      ...(actor
        ? [
            activityWrite(
              db,
              {
                actorId: actor.id,
                actorName: actor.name,
                action: 'material.update',
                objectType: 'material',
                objectId: String(input.id),
                summary: materialChangeSummary(value.name, { unitCost: current.unitCost, active: current.active === 1 }, { unitCost: value.unitCost, active: value.active }),
                createdAt: now,
              },
              true,
            ),
          ]
        : []),
    ]);
    return { ok: true, priceChanged: current.unitCost !== value.unitCost };
  }

  let code = value.code;
  if (code) {
    if (await codeTaken(db, code)) return { ok: false, error: 'Mã nguyên liệu đã được dùng.' };
  } else {
    const free = await freeCode(db, deriveMaterialCode(value.name));
    if (!free) return { ok: false, error: 'Không tạo được mã tự động. Hãy nhập mã khác.' };
    code = free;
  }
  try {
    await commitWrites(db, [
      db.insert(materials).values({ code, name: value.name, groupId: value.groupId, unitCost: value.unitCost, active: value.active ? 1 : 0, createdAt: now, updatedAt: now }),
      ...(actor
        ? [
            activityWrite(
              db,
              {
                actorId: actor.id,
                actorName: actor.name,
                action: 'material.create',
                objectType: 'material',
                objectId: null,
                summary: materialChangeSummary(value.name, null, { unitCost: value.unitCost, active: value.active }),
                createdAt: now,
                useLastInsertId: true,
              },
              true,
            ),
          ]
        : []),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: 'Mã nguyên liệu đã được dùng. Thử lại.' };
    throw error;
  }
  return { ok: true, priceChanged: false };
}

export async function deleteMaterial(
  db: AppDb,
  id: number,
  actor?: ActivityActor,
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rows = await db.select({ name: materials.name }).from(materials).where(eq(materials.id, id)).limit(1);
  const current = rows[0];
  if (!current) return { ok: false, error: 'Không tìm thấy nguyên liệu.' };
  const used = await db.select({ value: count() }).from(productMaterials).where(eq(productMaterials.materialId, id));
  const blocked = materialInUseError(used[0]?.value ?? 0);
  if (blocked) return { ok: false, error: blocked };
  try {
    await commitWrites(db, [
      db.delete(materials).where(eq(materials.id, id)),
      ...(actor
        ? [
            activityWrite(
              db,
              {
                actorId: actor.id,
                actorName: actor.name,
                action: 'material.delete',
                objectType: 'material',
                objectId: String(id),
                summary: `Đã xóa nguyên liệu “${quotedLabel(current.name, 'Không tên')}”.`,
                createdAt: now,
              },
              true,
            ),
          ]
        : []),
    ]);
  } catch {
    // Khóa ngoại chặn xóa nếu vừa có sản phẩm bắt đầu dùng nguyên liệu này giữa hai câu lệnh.
    return { ok: false, error: 'Nguyên liệu đang được sản phẩm dùng, chưa xóa được.' };
  }
  return { ok: true };
}
