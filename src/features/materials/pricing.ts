import { asc, count, eq, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { AppDb } from '../../lib/db/client';
import { materials, productMaterials, products } from '../../lib/db/schema';
import { activityWrite, commitWrites, quotedLabel, type ActivityActor } from '../activity/log';
import { MATERIAL_MAX_PRICE, repriceLines, type ImpactRow, type RepriceMode, type RepriceSource } from './costing';

export const IMPACT_LIMIT = 200;

// Giá vốn hiện tại của một sản phẩm (tổng số lượng x đơn giá nguyên liệu), 0 nếu chưa có công thức.
// Phải viết "products"."id" thay vì ${products.id}: với truy vấn một bảng Drizzle in tên cột trần ("id"),
// và trong truy vấn con "id" sẽ bị hiểu là cột id của bảng nguyên liệu, cho ra giá vốn 0.
const costOf = sql<number>`(
  select coalesce(sum(pm2.quantity * m2.unit_cost), 0)
  from product_materials pm2 join materials m2 on m2.id = pm2.material_id
  where pm2.product_id = "products"."id"
)`.mapWith(Number);

// Các sản phẩm đang dùng một nguyên liệu, kèm giá vốn hiện tại: để xem trước tác động khi đổi đơn giá.
export async function loadMaterialImpact(db: AppDb, materialId: number): Promise<{ total: number; rows: ImpactRow[] }> {
  const [totalRows, rows] = await Promise.all([
    db.select({ value: count() }).from(productMaterials).where(eq(productMaterials.materialId, materialId)),
    db
      .select({
        productId: products.id,
        name: products.name,
        price: products.price,
        status: products.status,
        quantity: productMaterials.quantity,
        cost: costOf,
      })
      .from(productMaterials)
      .innerJoin(products, eq(products.id, productMaterials.productId))
      .where(eq(productMaterials.materialId, materialId))
      .orderBy(asc(products.name), asc(products.id))
      .limit(IMPACT_LIMIT),
  ]);
  return { total: totalRows[0]?.value ?? 0, rows };
}

export async function loadMaterialReprice(db: AppDb, materialId: number): Promise<{ id: number; name: string; unitCost: number; total: number; rows: RepriceSource[] } | null> {
  const found = await db
    .select({ id: materials.id, name: materials.name, unitCost: materials.unitCost })
    .from(materials)
    .where(eq(materials.id, materialId))
    .limit(1);
  const material = found[0];
  if (!material) return null;
  const [totalRows, rows] = await Promise.all([
    db.select({ value: count() }).from(productMaterials).where(eq(productMaterials.materialId, materialId)),
    db
      .select({
        productId: products.id,
        name: products.name,
        price: products.price,
        comparePrice: products.comparePrice,
        status: products.status,
        quantity: productMaterials.quantity,
        cost: costOf,
      })
      .from(productMaterials)
      .innerJoin(products, eq(products.id, productMaterials.productId))
      .where(eq(productMaterials.materialId, materialId))
      .orderBy(asc(products.name), asc(products.id))
      .limit(IMPACT_LIMIT),
  ]);
  return { ...material, total: totalRows[0]?.value ?? 0, rows };
}

const REPRICE_CHUNK = 40;

// Tính lại giá trên server từ đơn giá đang lưu. Bỏ qua dòng bị giá gốc chặn hoặc giá mới trùng giá hiện tại.
export async function applyMaterialReprice(
  db: AppDb,
  input: { materialId: number; previousUnitCost: number; unitCost: number; mode: Exclude<RepriceMode, 'none'>; margin: number; step: number; ids: readonly number[] },
  actor?: ActivityActor,
  now = Date.now(),
): Promise<{ ok: true; updated: number; skipped: number } | { ok: false; error: string }> {
  const selected = [...new Set(input.ids)].filter((id) => Number.isInteger(id) && id > 0);
  if (selected.length === 0) return { ok: false, error: 'Chưa chọn sản phẩm nào.' };
  if (!Number.isInteger(input.previousUnitCost) || input.previousUnitCost < 0 || input.previousUnitCost > MATERIAL_MAX_PRICE) {
    return { ok: false, error: 'Không xác định được đơn giá cũ.' };
  }
  if (!Number.isInteger(input.unitCost) || input.unitCost < 0 || input.unitCost > MATERIAL_MAX_PRICE || input.unitCost === input.previousUnitCost) {
    return { ok: false, error: 'Không xác định được đơn giá mới.' };
  }
  const context = await loadMaterialReprice(db, input.materialId);
  if (!context) return { ok: false, error: 'Không tìm thấy nguyên liệu.' };
  if (context.unitCost !== input.unitCost) return { ok: false, error: 'Đơn giá vừa được sửa tiếp. Hãy mở lại bảng cập nhật giá.' };
  const picked = new Set(selected);
  const lines = repriceLines(context.rows, input.previousUnitCost, context.unitCost, input.mode, input.margin, input.step).filter(
    (line) => picked.has(line.productId) && line.changed && line.nextPrice !== null,
  );
  const writes: BatchItem<'sqlite'>[] = [];
  for (const line of lines) {
    if (line.nextPrice === null) continue;
    writes.push(db.update(products).set({ price: line.nextPrice, updatedAt: now }).where(eq(products.id, line.productId)));
  }
  for (let index = 0; index < writes.length; index += REPRICE_CHUNK) {
    await commitWrites(db, writes.slice(index, index + REPRICE_CHUNK));
  }
  const updated = writes.length;
  if (updated > 0 && actor) {
    const how = input.mode === 'keep' ? 'giữ tiền lời' : `biên ${input.margin}%, làm tròn ${input.step}`;
    await commitWrites(db, [
      activityWrite(
        db,
        {
          actorId: actor.id,
          actorName: actor.name,
          action: 'product.reprice',
          objectType: 'material',
          objectId: String(context.id),
          summary: `Đổi giá bán ${updated} sản phẩm vì đơn giá “${quotedLabel(context.name, 'Nguyên liệu')}” (${how}).`,
          createdAt: now,
        },
        false,
      ),
    ]);
  }
  return { ok: true, updated, skipped: selected.length - updated };
}
