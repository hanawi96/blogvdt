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

/** Công thức mặc định khi thêm sản phẩm mới: khớp theo tên nguyên liệu đang dùng. */
export const DEFAULT_NEW_PRODUCT_MATERIALS: ReadonlyArray<{ name: string; quantity: number }> = [
  { name: 'Chi phí làm vòng', quantity: 1 },
  { name: 'Hạt dâu tằm', quantity: 10 },
];

export function defaultNewProductRecipe(catalog: readonly MaterialOption[]): RecipeLine[] {
  const byName = new Map(catalog.filter((item) => item.active).map((item) => [item.name.replace(/\s+/g, ' ').trim().toLocaleLowerCase('vi'), item]));
  const lines: RecipeLine[] = [];
  const seen = new Set<number>();
  for (const preset of DEFAULT_NEW_PRODUCT_MATERIALS) {
    const found = byName.get(preset.name.replace(/\s+/g, ' ').trim().toLocaleLowerCase('vi'));
    if (!found || seen.has(found.id)) continue;
    seen.add(found.id);
    lines.push({ materialId: found.id, quantity: preset.quantity });
  }
  return lines;
}

// ---- Biên lợi nhuận, giá đề xuất, tác động khi đổi giá nguyên liệu ----

export const LOW_MARGIN_PERCENT = 30;
export const DEFAULT_TARGET_MARGIN = 60;
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

// ---- Cập nhật giá bán sau khi đơn giá nguyên liệu đã lưu ----

export type RepriceMode = 'keep' | 'margin' | 'none';

// cost là giá vốn SAU khi đơn giá mới đã ghi vào database.
export type RepriceSource = {
  productId: number;
  name: string;
  price: number;
  comparePrice: number | null;
  cost: number;
  quantity: number;
  status: string;
};

export type RepriceLine = RepriceSource & {
  nextPrice: number | null;
  marginBefore: number | null;
  marginAfter: number | null;
  blocked: boolean;
  changed: boolean;
  warn: boolean;
};

// Giữ số tiền lời: cộng đúng phần vốn tăng/giảm, rồi làm tròn LÊN theo bước.
export function keepProfitPrice(price: number, deltaCost: number, step: number): number | null {
  if (!Number.isInteger(price) || !Number.isInteger(deltaCost) || price < 0) return null;
  const raw = price + deltaCost;
  if (raw < 0) return null;
  const size = Math.max(1, Math.floor(step));
  const rounded = Math.ceil(raw / size) * size;
  return rounded <= MAX_PRODUCT_PRICE ? rounded : null;
}

export function repriceLines(
  rows: readonly RepriceSource[],
  oldUnit: number,
  newUnit: number,
  mode: RepriceMode,
  margin: number,
  step: number,
): RepriceLine[] {
  const unitChange = newUnit - oldUnit;
  return rows.map((row) => {
    const marginBefore = profitOf(row.price, row.cost).marginPercent;
    const nextPrice =
      mode === 'keep'
        ? keepProfitPrice(row.price, row.quantity * unitChange, step)
        : mode === 'margin'
          ? suggestedPrice(row.cost, margin, step)
          : null;
    const blocked =
      nextPrice !== null &&
      nextPrice !== row.price &&
      row.comparePrice !== null &&
      row.comparePrice > 0 &&
      nextPrice >= row.comparePrice;
    const changed = nextPrice !== null && nextPrice !== row.price && !blocked;
    const marginAfter = nextPrice === null ? null : profitOf(nextPrice, row.cost).marginPercent;
    const shown = changed && nextPrice !== null ? nextPrice : row.price;
    const shownTone = marginTone(profitOf(shown, row.cost).marginPercent);
    const warn = blocked || shownTone === 'low' || shownTone === 'loss' || marginTone(marginBefore) === 'loss';
    return { ...row, nextPrice, marginBefore, marginAfter, blocked, changed, warn };
  });
}

// Mở bảng khi còn sản phẩm và ít nhất một cách tính làm giá bán đổi hoặc bị giá gốc chặn.
// Đơn giá giảm thì chọn sẵn «không đổi»; đơn giá tăng thì ưu tiên giữ tiền lời.
export function repriceOffer(
  rows: readonly RepriceSource[],
  oldUnit: number,
  newUnit: number,
): { open: boolean; mode: RepriceMode } {
  if (!Number.isInteger(oldUnit) || !Number.isInteger(newUnit) || oldUnit === newUnit || rows.length === 0) {
    return { open: false, mode: 'none' };
  }
  const keep = repriceLines(rows, oldUnit, newUnit, 'keep', DEFAULT_TARGET_MARGIN, DEFAULT_ROUND_STEP);
  const margin = repriceLines(rows, oldUnit, newUnit, 'margin', DEFAULT_TARGET_MARGIN, DEFAULT_ROUND_STEP);
  const needsDecision = (lines: readonly RepriceLine[]) => lines.some((line) => line.changed || line.blocked);
  if (!needsDecision(keep) && !needsDecision(margin)) return { open: false, mode: 'none' };
  if (newUnit < oldUnit) return { open: true, mode: 'none' };
  if (needsDecision(keep)) return { open: true, mode: 'keep' };
  return { open: true, mode: 'margin' };
}

export function repriceNote(line: RepriceLine, mode: RepriceMode, compareLabel: string): string {
  if (line.blocked) return `Giá mới chạm hoặc vượt giá gốc ${compareLabel}, chưa chọn.`;
  if (mode !== 'none' && line.nextPrice === null) return 'Không tính được giá mới trong giới hạn cho phép.';
  if (mode !== 'none' && !line.changed) return '';
  if (line.marginBefore !== null && line.marginBefore < 0) return 'Giữ giá bán hiện tại sẽ bị lỗ.';
  return '';
}
