import { asc, count, eq, max, sql } from 'drizzle-orm';
import { activityWrite, commitWrites, quotedLabel, type ActivityActor } from '../activity/log';
import { isUniqueViolation } from '../orders/order';
import { categoryMovePlan } from '../products/categories';
import type { AppDb } from '../../lib/db/client';
import { materialGroups, materials } from '../../lib/db/schema';

export const GROUP_NAME_MAX = 80;

export type MaterialGroup = { id: number; name: string; sortOrder: number; materialCount: number };

export function normalizeGroupName(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function parseGroupName(value: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = normalizeGroupName(value);
  if (!name) return { ok: false, error: 'Nhập tên nhóm.' };
  if (name.length > GROUP_NAME_MAX) return { ok: false, error: 'Tên nhóm quá dài.' };
  return { ok: true, name };
}

export function groupInUseError(used: number): string | null {
  if (used <= 0) return null;
  return `Nhóm đang có ${used} nguyên liệu, chưa xóa được. Hãy chuyển nguyên liệu sang nhóm khác trước.`;
}

// Số nguyên liệu mỗi nhóm đếm bằng truy vấn con. Phải viết "material_groups"."id" rõ ràng:
// Drizzle in tên cột trần ("id") với truy vấn một bảng, trong truy vấn con sẽ bị hiểu thành id của bảng materials.
const materialCountOf = sql<number>`(select count(*) from materials m where m.group_id = "material_groups"."id")`.mapWith(Number);

export async function listGroups(db: AppDb): Promise<MaterialGroup[]> {
  return db
    .select({ id: materialGroups.id, name: materialGroups.name, sortOrder: materialGroups.sortOrder, materialCount: materialCountOf })
    .from(materialGroups)
    .orderBy(asc(materialGroups.sortOrder), asc(materialGroups.name), asc(materialGroups.id));
}

async function nameTaken(db: AppDb, name: string, exceptId: number | null): Promise<boolean> {
  const rows = await db
    .select({ id: materialGroups.id })
    .from(materialGroups)
    .where(sql`lower(${materialGroups.name}) = ${name.toLowerCase()}`)
    .limit(1);
  const found = rows[0];
  return Boolean(found) && found?.id !== exceptId;
}

export async function saveGroup(
  db: AppDb,
  input: { id?: number; name: string },
  now = Date.now(),
  actor?: ActivityActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = parseGroupName(input.name);
  if (!parsed.ok) return parsed;
  const { name } = parsed;
  if (await nameTaken(db, name, input.id ?? null)) return { ok: false, error: 'Tên nhóm đã tồn tại.' };

  try {
    if (input.id) {
      const rows = await db.select({ name: materialGroups.name }).from(materialGroups).where(eq(materialGroups.id, input.id)).limit(1);
      const current = rows[0];
      if (!current) return { ok: false, error: 'Không tìm thấy nhóm.' };
      if (current.name === name) return { ok: true };
      await commitWrites(db, [
        db.update(materialGroups).set({ name, updatedAt: now }).where(eq(materialGroups.id, input.id)),
        ...(actor
          ? [
              activityWrite(
                db,
                {
                  actorId: actor.id,
                  actorName: actor.name,
                  action: 'material_group.update',
                  objectType: 'material_group',
                  objectId: String(input.id),
                  summary: `Đổi tên nhóm nguyên liệu “${quotedLabel(current.name, 'Không tên')}” thành “${quotedLabel(name, 'Không tên')}”.`,
                  createdAt: now,
                },
                true,
              ),
            ]
          : []),
      ]);
      return { ok: true };
    }
    const highest = await db.select({ value: max(materialGroups.sortOrder) }).from(materialGroups);
    const sortOrder = (highest[0]?.value ?? -1) + 1;
    await commitWrites(db, [
      db.insert(materialGroups).values({ name, sortOrder, createdAt: now, updatedAt: now }),
      ...(actor
        ? [
            activityWrite(
              db,
              {
                actorId: actor.id,
                actorName: actor.name,
                action: 'material_group.create',
                objectType: 'material_group',
                objectId: null,
                summary: `Đã tạo nhóm nguyên liệu “${quotedLabel(name, 'Không tên')}”.`,
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
    // Hai người cùng tạo một tên: chỉ mục duy nhất theo lower(name) ở database chặn trường hợp này.
    if (isUniqueViolation(error)) return { ok: false, error: 'Tên nhóm đã tồn tại.' };
    throw error;
  }
}

export async function moveGroup(db: AppDb, id: number, direction: 'up' | 'down'): Promise<{ ok: true; moved: boolean }> {
  const rows = await db
    .select({ id: materialGroups.id, sortOrder: materialGroups.sortOrder })
    .from(materialGroups)
    .orderBy(asc(materialGroups.sortOrder), asc(materialGroups.name), asc(materialGroups.id));
  const plan = categoryMovePlan(rows, id, direction);
  if (plan.length === 0) return { ok: true, moved: false };
  await commitWrites(
    db,
    plan.map((item) => db.update(materialGroups).set({ sortOrder: item.sortOrder }).where(eq(materialGroups.id, item.id))),
  );
  return { ok: true, moved: true };
}

export async function deleteGroup(
  db: AppDb,
  id: number,
  actor?: ActivityActor,
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rows = await db.select({ name: materialGroups.name }).from(materialGroups).where(eq(materialGroups.id, id)).limit(1);
  const current = rows[0];
  if (!current) return { ok: false, error: 'Không tìm thấy nhóm.' };
  const used = await db.select({ value: count() }).from(materials).where(eq(materials.groupId, id));
  const blocked = groupInUseError(used[0]?.value ?? 0);
  if (blocked) return { ok: false, error: blocked };
  try {
    await commitWrites(db, [
      db.delete(materialGroups).where(eq(materialGroups.id, id)),
      ...(actor
        ? [
            activityWrite(
              db,
              {
                actorId: actor.id,
                actorName: actor.name,
                action: 'material_group.delete',
                objectType: 'material_group',
                objectId: String(id),
                summary: `Đã xóa nhóm nguyên liệu “${quotedLabel(current.name, 'Không tên')}”.`,
                createdAt: now,
              },
              true,
            ),
          ]
        : []),
    ]);
  } catch {
    // Khóa ngoại chặn xóa nếu vừa có nguyên liệu được gán vào nhóm này giữa hai câu lệnh.
    return { ok: false, error: 'Nhóm đang có nguyên liệu, chưa xóa được.' };
  }
  return { ok: true };
}
