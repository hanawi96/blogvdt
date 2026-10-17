// Tính giá vốn từ công thức nguyên liệu. File thuần (không chạm database) nên dùng được cả ở trình duyệt.

export const MATERIAL_MAX_PRICE = 99_999_999;

// Chấp nhận "35000", "35.000", "35,000", "35 000": dấu chấm, phẩy, khoảng trắng chỉ là phân cách hàng nghìn.
export function parseMaterialPrice(value: string): number | null {
  const digits = value.replace(/[.,\s]/g, '');
  if (!/^\d{1,9}$/.test(digits)) return null;
  const price = Number(digits);
  return price <= MATERIAL_MAX_PRICE ? price : null;
}

export const RECIPE_MAX_LINES = 30;
export const RECIPE_MAX_QUANTITY = 999;

export type RecipeLine = { materialId: number; quantity: number };

export type MaterialOption = { id: number; name: string; group: string; unitCost: number; active: boolean };

export type CostedLine = RecipeLine & { name: string; group: string; unitCost: number; active: boolean };

export function lineCost(unitCost: number, quantity: number): number {
  return unitCost * quantity;
}

export function recipeCost(lines: ReadonlyArray<{ unitCost: number; quantity: number }>): number {
  return lines.reduce((sum, line) => sum + lineCost(line.unitCost, line.quantity), 0);
}

// Biên lợi nhuận = lợi nhuận / giá bán. Giá bán 0 thì không có biên để so sánh (null).
export function profitOf(price: number, cost: number): { profit: number; marginPercent: number | null } {
  const profit = price - cost;
  return { profit, marginPercent: price > 0 ? Math.round((profit / price) * 100) : null };
}

export function parseRecipe(ids: readonly string[], quantities: readonly string[]): { ok: true; lines: RecipeLine[] } | { ok: false; error: string } {
  if (ids.length !== quantities.length) return { ok: false, error: 'Công thức nguyên liệu không hợp lệ.' };
  if (ids.length > RECIPE_MAX_LINES) return { ok: false, error: `Tối đa ${RECIPE_MAX_LINES} nguyên liệu mỗi sản phẩm.` };
  const lines: RecipeLine[] = [];
  const seen = new Set<number>();
  for (let index = 0; index < ids.length; index += 1) {
    const idText = (ids[index] ?? '').trim();
    const quantityText = (quantities[index] ?? '').trim();
    if (!/^\d{1,9}$/.test(idText) || !/^\d{1,4}$/.test(quantityText)) return { ok: false, error: 'Công thức nguyên liệu không hợp lệ.' };
    const materialId = Number(idText);
    const quantity = Number(quantityText);
    if (materialId < 1) return { ok: false, error: 'Công thức nguyên liệu không hợp lệ.' };
    if (quantity < 1 || quantity > RECIPE_MAX_QUANTITY) return { ok: false, error: `Số lượng mỗi nguyên liệu từ 1 đến ${RECIPE_MAX_QUANTITY}.` };
    if (seen.has(materialId)) return { ok: false, error: 'Một nguyên liệu chỉ được chọn một lần. Hãy tăng số lượng.' };
    seen.add(materialId);
    lines.push({ materialId, quantity });
  }
  return { ok: true, lines };
}

// Gắn thông tin hiển thị cho các dòng công thức; bỏ qua nguyên liệu không còn trong danh mục tra cứu.
export function resolveRecipeLines(lines: readonly RecipeLine[], catalog: readonly MaterialOption[]): CostedLine[] {
  const byId = new Map(catalog.map((item) => [item.id, item]));
  return lines.flatMap((line) => {
    const found = byId.get(line.materialId);
    return found ? [{ ...line, name: found.name, group: found.group, unitCost: found.unitCost, active: found.active }] : [];
  });
}

// ---- Biên lợi nhuận, giá đề xuất, tác động khi đổi giá nguyên liệu ----

export const LOW_MARGIN_PERCENT = 30;
export const DEFAULT_TARGET_MARGIN = 40;
export const MAX_TARGET_MARGIN = 90;
export const ROUND_STEPS = [1, 500, 1000, 5000, 10000] as const;
export const DEFAULT_ROUND_STEP = 1000;
// Khớp giới hạn 8 chữ số của ô Giá trong form sản phẩm.
export const MAX_PRODUCT_PRICE = 99_999_999;

export type MarginTone = 'loss' | 'low' | 'ok' | 'none';

export function marginTone(marginPercent: number | null): MarginTone {
  if (marginPercent === null) return 'none';
  if (marginPercent < 0) return 'loss';
  return marginPercent < LOW_MARGIN_PERCENT ? 'low' : 'ok';
}

export function parseTargetMargin(value: string | null | undefined): number {
  const text = (value ?? '').trim();
  if (!/^\d{1,2}$/.test(text)) return DEFAULT_TARGET_MARGIN;
  const margin = Number(text);
  return margin <= MAX_TARGET_MARGIN ? margin : DEFAULT_TARGET_MARGIN;
}

export function parseRoundStep(value: string | null | undefined): number {
  const step = Number((value ?? '').trim());
  return ROUND_STEPS.find((item) => item === step) ?? DEFAULT_ROUND_STEP;
}

// Giá bán nhỏ nhất (làm tròn LÊN theo bước) để đạt biên mục tiêu: giá = vốn / (1 - biên).
// Dùng toán số nguyên (vốn*100 / ((100-biên)*bước)) để không bị sai số số thực làm nhảy lên một bước.
export function suggestedPrice(cost: number, targetMargin: number, step: number): number | null {
  if (!Number.isInteger(cost) || cost <= 0) return null;
  const margin = Math.min(MAX_TARGET_MARGIN, Math.max(0, Math.floor(targetMargin)));
  const size = Math.max(1, Math.floor(step));
  const units = Math.ceil((cost * 100) / ((100 - margin) * size));
  const price = units * size;
  return price <= MAX_PRODUCT_PRICE ? price : null;
}

export type ImpactRow = { productId: number; name: string; price: number; cost: number; quantity: number; status: string };

export type ImpactItem = ImpactRow & {
  deltaCost: number;
  newCost: number;
  marginBefore: number | null;
  marginAfter: number | null;
  toneAfter: MarginTone;
};

// Điều gì xảy ra với từng sản phẩm đang dùng nguyên liệu nếu đơn giá đổi từ oldUnit sang newUnit.
export function impactOfUnitCostChange(rows: readonly ImpactRow[], oldUnit: number, newUnit: number) {
  const unitChange = newUnit - oldUnit;
  const items: ImpactItem[] = rows.map((row) => {
    const deltaCost = row.quantity * unitChange;
    const newCost = row.cost + deltaCost;
    const marginAfter = profitOf(row.price, newCost).marginPercent;
    return {
      ...row,
      deltaCost,
      newCost,
      marginBefore: profitOf(row.price, row.cost).marginPercent,
      marginAfter,
      toneAfter: marginTone(marginAfter),
    };
  });
  const deltas = items.map((item) => item.deltaCost);
  const flagged = items
    .filter((item) => item.toneAfter === 'loss' || item.toneAfter === 'low')
    .sort((a, b) => (a.marginAfter ?? 0) - (b.marginAfter ?? 0) || a.productId - b.productId);
  return {
    count: items.length,
    minDelta: deltas.length > 0 ? Math.min(...deltas) : 0,
    maxDelta: deltas.length > 0 ? Math.max(...deltas) : 0,
    flagged,
    items,
  };
}
