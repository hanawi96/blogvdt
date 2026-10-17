import { asc, eq, inArray, or, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { AppDb } from '../../lib/db/client';
import { materialGroups, materials, productMaterials } from '../../lib/db/schema';
import type { CostedLine, MaterialOption, RecipeLine } from './costing';

// Công thức hiện tại của một sản phẩm, kèm đơn giá nguyên liệu lúc này.
export async function loadRecipe(db: AppDb, productId: number): Promise<CostedLine[]> {
  const rows = await db
    .select({
      materialId: productMaterials.materialId,
      quantity: productMaterials.quantity,
      name: materials.name,
      group: sql<string>`coalesce(${materialGroups.name}, 'Chưa phân nhóm')`.mapWith(String),
      unitCost: materials.unitCost,
      active: materials.active,
    })
    .from(productMaterials)
    .innerJoin(materials, eq(materials.id, productMaterials.materialId))
    .leftJoin(materialGroups, eq(materials.groupId, materialGroups.id))
    .where(eq(productMaterials.productId, productId))
    .orderBy(asc(sql`coalesce(${materialGroups.sortOrder}, 2147483647)`), asc(materials.name), asc(materials.id));
  return rows.map((row) => ({ ...row, active: row.active === 1 }));
}

// Nguyên liệu đang dùng để chọn, cộng thêm các nguyên liệu đã ngừng dùng nhưng vẫn nằm trong công thức (extraIds)
// để sản phẩm cũ vẫn hiển thị đủ.
export async function listRecipeOptions(db: AppDb, extraIds: readonly number[] = []): Promise<MaterialOption[]> {
  const extra = extraIds.slice(0, 50);
  const rows = await db
    .select({ id: materials.id, name: materials.name, group: sql<string>`coalesce(${materialGroups.name}, 'Chưa phân nhóm')`.mapWith(String), unitCost: materials.unitCost, active: materials.active })
    .from(materials)
    .leftJoin(materialGroups, eq(materials.groupId, materialGroups.id))
    .where(extra.length > 0 ? or(eq(materials.active, 1), inArray(materials.id, extra)) : eq(materials.active, 1))
    .orderBy(asc(sql`coalesce(${materialGroups.sortOrder}, 2147483647)`), asc(materials.name), asc(materials.id))
    .limit(2000);
  return rows.map((row) => ({ ...row, active: row.active === 1 }));
}

// Mọi nguyên liệu phải tồn tại. Nguyên liệu đã ngừng dùng chỉ được giữ nếu sản phẩm đang dùng nó sẵn.
export async function validateRecipe(db: AppDb, lines: readonly RecipeLine[], productId: number | null): Promise<string | null> {
  if (lines.length === 0) return null;
  const ids = lines.map((line) => line.materialId);
  const found = await db
    .select({ id: materials.id, name: materials.name, active: materials.active })
    .from(materials)
    .where(inArray(materials.id, ids));
  if (found.length !== new Set(ids).size) return 'Có nguyên liệu không còn tồn tại. Hãy tải lại trang.';
  const inactive = found.filter((item) => item.active !== 1);
  if (inactive.length === 0) return null;
  const current =
    productId === null
      ? []
      : await db.select({ id: productMaterials.materialId }).from(productMaterials).where(eq(productMaterials.productId, productId));
  const kept = new Set(current.map((item) => item.id));
  const blocked = inactive.find((item) => !kept.has(item.id));
  return blocked ? `Nguyên liệu “${blocked.name}” đã ngừng dùng, không thêm mới được.` : null;
}

export function insertRecipe(db: AppDb, productId: number, lines: readonly RecipeLine[]) {
  return db.insert(productMaterials).values(lines.map((line) => ({ productId, materialId: line.materialId, quantity: line.quantity })));
}

// Thay toàn bộ công thức của sản phẩm trong cùng một batch với các lệnh khác (nguyên tử).
export function recipeWrites(db: AppDb, productId: number, lines: readonly RecipeLine[]): BatchItem<'sqlite'>[] {
  const writes: BatchItem<'sqlite'>[] = [db.delete(productMaterials).where(eq(productMaterials.productId, productId))];
  if (lines.length > 0) writes.push(insertRecipe(db, productId, lines));
  return writes;
}

// Giá vốn của mọi sản phẩm đã có công thức, trong một truy vấn nhóm (không tham số nên không vướng giới hạn của D1).
export async function loadProductCosts(db: AppDb): Promise<Map<number, number>> {
  const rows = await db
    .select({
      productId: productMaterials.productId,
      cost: sql<number>`sum(${productMaterials.quantity} * ${materials.unitCost})`.mapWith(Number),
    })
    .from(productMaterials)
    .innerJoin(materials, eq(materials.id, productMaterials.materialId))
    .groupBy(productMaterials.productId);
  return new Map(rows.map((row) => [row.productId, row.cost]));
}
