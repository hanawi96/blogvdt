/**
 * Đồng bộ công thức nguyên liệu Turso → D1 local.
 * Map sản phẩm theo tên; map nguyên liệu theo code/alias/tên → materials hiện có.
 * Tạo material còn thiếu từ cost_config; không ghi cost_price giả.
 *
 *   TURSO_URL=... TURSO_TOKEN=... node scripts/sync-turso-recipes-local.mjs
 *   ... --apply
 *   ... --apply --sync-prices   # cập nhật unit_cost từ Turso cost_config
 */
import { getPlatformProxy } from 'wrangler';

if (process.argv.includes('--remote')) {
  console.error('Script này chỉ ghi D1 local. Không dùng --remote.');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');
const SYNC_PRICES = process.argv.includes('--sync-prices');
const TURSO_URL = process.env.TURSO_URL || process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_TOKEN || process.env.TURSO_AUTH_TOKEN;
if (!TURSO_URL || !TURSO_TOKEN) {
  console.error('Thiếu TURSO_URL và TURSO_TOKEN.');
  process.exit(1);
}

/** Turso material_name → D1 materials.code đã có (nếu khác). */
const MATERIAL_ALIASES = {
  bi_bac_3ly_s999: 'bi_bac_3ly',
  bi_bac_4ly_s999: 'bac_4ly',
  bi_bac_5ly_s999: 'bi_bac_5ly',
  bi_bac_6ly_s999: 'bi_bac_6ly',
  labor_cost: 'chi_phi_lam_vong',
  the_bac_khac_ten: 'the_ten_be',
  da_do: 'da_do_tu_nhien',
  ho_phach_vang: 'ho_phach',
  ho_phach_nau: 'ho_phach',
};

/** Turso material_categories.name → tên nhóm D1. */
const GROUP_ALIASES = {
  bat_buoc: 'Bắt buộc',
  day_xo: 'Dây xỏ',
  bi_bac_s999: 'Bi Bạc',
  da_ho_phach: 'Hạt mix',
  charm_bac: 'Charm bạc',
  dong_goi: 'Đóng gói',
  chi_phi_van_hanh: 'Chi phí vận hành',
};

const LETTERS = {
  à: 'a', á: 'a', ạ: 'a', ả: 'a', ã: 'a', â: 'a', ầ: 'a', ấ: 'a', ậ: 'a', ẩ: 'a', ẫ: 'a',
  ă: 'a', ằ: 'a', ắ: 'a', ặ: 'a', ẳ: 'a', ẵ: 'a',
  è: 'e', é: 'e', ẹ: 'e', ẻ: 'e', ẽ: 'e', ê: 'e', ề: 'e', ế: 'e', ệ: 'e', ể: 'e', ễ: 'e',
  ì: 'i', í: 'i', ị: 'i', ỉ: 'i', ĩ: 'i',
  ò: 'o', ó: 'o', ọ: 'o', ỏ: 'o', õ: 'o', ô: 'o', ồ: 'o', ố: 'o', ộ: 'o', ổ: 'o', ỗ: 'o',
  ơ: 'o', ờ: 'o', ớ: 'o', ợ: 'o', ở: 'o', ỡ: 'o',
  ù: 'u', ú: 'u', ụ: 'u', ủ: 'u', ũ: 'u', ư: 'u', ừ: 'u', ứ: 'u', ự: 'u', ử: 'u', ữ: 'u',
  ỳ: 'y', ý: 'y', ỵ: 'y', ỷ: 'y', ỹ: 'y',
  đ: 'd',
};

function slugify(value) {
  const lower = String(value || '')
    .trim()
    .toLowerCase();
  let result = '';
  for (const char of lower) result += LETTERS[char] ?? char;
  return result
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180);
}

function toQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const q = Math.round(n);
  if (q < 1 || q > 999) return null;
  return q;
}

function toUnitCost(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(Math.round(n), 99_999_999);
}

function codeFromTurso(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

const { createClient } = await import('@libsql/client');
const turso = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
const proxy = await getPlatformProxy({ persist: true });

try {
  const db = proxy.env.DB;
  if (!db) {
    console.error('Thiếu binding DB local.');
    process.exit(1);
  }

  console.log(APPLY ? 'APPLY → ghi D1 local.' : 'Dry-run (không ghi). Thêm --apply để ghi.');
  if (SYNC_PRICES) console.log('Đồng bộ unit_cost từ Turso cost_config.');

  const [productsTurso, recipesTurso, costConfig, materialCats] = await Promise.all([
    turso.execute(`SELECT id, name, cost_price FROM products ORDER BY id`),
    turso.execute(`
      SELECT product_id, material_name, quantity
      FROM product_materials
      ORDER BY product_id, id
    `),
    turso.execute(`SELECT item_name, display_name, item_cost, category_id FROM cost_config`),
    turso.execute(`SELECT id, name, display_name FROM material_categories`),
  ]);

  const usedCodes = new Set(recipesTurso.rows.map((r) => String(r.material_name || '').trim()).filter(Boolean));
  /** @type {Map<string, { item_name: string, display_name: string, item_cost: number, category_id: number|null }>} */
  const configByCode = new Map();
  for (const row of costConfig.rows) {
    const item_name = String(row.item_name || '').trim();
    if (!item_name) continue;
    configByCode.set(item_name, {
      item_name,
      display_name: String(row.display_name || item_name).trim() || item_name,
      item_cost: Number(row.item_cost) || 0,
      category_id: row.category_id == null ? null : Number(row.category_id),
    });
  }

  /** @type {Map<number, string>} */
  const catById = new Map();
  for (const row of materialCats.rows) {
    catById.set(Number(row.id), String(row.name || ''));
  }

  const localProducts = (await db.prepare('SELECT id, name, slug FROM products ORDER BY id').all()).results;
  /** @type {Map<string, { id: number, name: string, slug: string }>} */
  const productByName = new Map();
  /** @type {Map<string, { id: number, name: string, slug: string }[]>} */
  const productBySlug = new Map();
  for (const row of localProducts) {
    const item = { id: Number(row.id), name: String(row.name ?? ''), slug: String(row.slug ?? '') };
    const nameKey = item.name.trim().toLowerCase();
    if (nameKey) productByName.set(nameKey, item);
    for (const key of new Set([item.slug, slugify(item.name)].filter(Boolean))) {
      const list = productBySlug.get(key) ?? [];
      if (!list.some((x) => x.id === item.id)) list.push(item);
      productBySlug.set(key, list);
    }
  }

  function resolveProduct(name) {
    const trimmed = String(name || '').trim();
    const exact = productByName.get(trimmed.toLowerCase());
    if (exact) return { hit: exact, via: 'name' };
    const key = slugify(trimmed);
    if (!key) return null;
    const list = productBySlug.get(key) ?? [];
    if (list.length === 1) return { hit: list[0], via: 'slug' };
    if (list.length > 1) return { ambiguous: list.map((p) => ({ id: p.id, name: p.name })) };
    return null;
  }

  // —— nhóm ——
  let groups = (await db.prepare('SELECT id, name FROM material_groups ORDER BY id').all()).results.map((r) => ({
    id: Number(r.id),
    name: String(r.name ?? ''),
  }));
  /** @type {Map<string, number>} */
  const groupIdByName = new Map(groups.map((g) => [g.name.trim().toLowerCase(), g.id]));

  async function ensureGroup(preferredName) {
    const name = preferredName.trim() || 'Khác';
    const key = name.toLowerCase();
    const existing = groupIdByName.get(key);
    if (existing) return existing;
    if (!APPLY) {
      const fakeId = -(groupIdByName.size + 1);
      groupIdByName.set(key, fakeId);
      groups.push({ id: fakeId, name });
      return fakeId;
    }
    const now = Date.now();
    const result = await db
      .prepare('INSERT INTO material_groups (name, sort_order, created_at, updated_at) VALUES (?, 0, ?, ?)')
      .bind(name, now, now)
      .run();
    const id = Number(result.meta.last_row_id);
    groupIdByName.set(key, id);
    groups.push({ id, name });
    return id;
  }

  // —— materials ——
  let materials = (
    await db.prepare('SELECT id, code, name, group_id, unit_cost, active FROM materials ORDER BY id').all()
  ).results.map((r) => ({
    id: Number(r.id),
    code: String(r.code ?? ''),
    name: String(r.name ?? ''),
    groupId: r.group_id == null ? null : Number(r.group_id),
    unitCost: Number(r.unit_cost) || 0,
    active: Number(r.active) === 1,
  }));

  /** @type {Map<string, typeof materials[0]>} */
  const materialByCode = new Map(materials.map((m) => [m.code, m]));
  /** @type {Map<string, typeof materials[0]>} */
  const materialByName = new Map();
  for (const m of materials) {
    const key = m.name.trim().toLowerCase();
    if (key && !materialByName.has(key)) materialByName.set(key, m);
  }

  function findMaterial(tursoCode) {
    const code = String(tursoCode || '').trim();
    if (!code) return null;
    const aliased = MATERIAL_ALIASES[code] ?? code;
    if (materialByCode.has(aliased)) return { material: materialByCode.get(aliased), via: 'alias-or-code', code: aliased };
    if (materialByCode.has(code)) return { material: materialByCode.get(code), via: 'code', code };
    const cfg = configByCode.get(code);
    if (cfg) {
      const byName = materialByName.get(cfg.display_name.trim().toLowerCase());
      if (byName) return { material: byName, via: 'display-name', code: byName.code };
    }
    return null;
  }

  const createdMaterials = [];
  const updatedPrices = [];
  const unresolvedMaterials = [];

  for (const tursoCode of [...usedCodes].sort()) {
    const found = findMaterial(tursoCode);
    const cfg = configByCode.get(tursoCode);
    const unitCost = cfg ? toUnitCost(cfg.item_cost) : null;

    if (found) {
      if (SYNC_PRICES && unitCost != null && found.material.unitCost !== unitCost) {
        updatedPrices.push({
          id: found.material.id,
          code: found.material.code,
          from: found.material.unitCost,
          to: unitCost,
          tursoCode,
        });
        if (APPLY) {
          await db
            .prepare('UPDATE materials SET unit_cost = ?, updated_at = ? WHERE id = ?')
            .bind(unitCost, Date.now(), found.material.id)
            .run();
          found.material.unitCost = unitCost;
        }
      }
      continue;
    }

    if (!cfg || unitCost == null) {
      unresolvedMaterials.push(tursoCode);
      continue;
    }

    const newCode = codeFromTurso(MATERIAL_ALIASES[tursoCode] ?? tursoCode);
    if (materialByCode.has(newCode)) continue;

    const catKey = cfg.category_id != null ? catById.get(cfg.category_id) : '';
    const groupName = GROUP_ALIASES[catKey || ''] || 'Khác';
    const groupId = await ensureGroup(groupName);

    createdMaterials.push({
      code: newCode,
      name: cfg.display_name,
      unitCost,
      groupId,
      tursoCode,
      groupName,
    });

    if (APPLY) {
      const now = Date.now();
      const result = await db
        .prepare(
          `INSERT INTO materials (code, name, group_id, unit_cost, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`,
        )
        .bind(newCode, cfg.display_name, groupId > 0 ? groupId : null, unitCost, now, now)
        .run();
      const id = Number(result.meta.last_row_id);
      const material = {
        id,
        code: newCode,
        name: cfg.display_name,
        groupId: groupId > 0 ? groupId : null,
        unitCost,
        active: true,
      };
      materials.push(material);
      materialByCode.set(newCode, material);
      materialByName.set(cfg.display_name.trim().toLowerCase(), material);
    } else {
      const material = {
        id: -(createdMaterials.length),
        code: newCode,
        name: cfg.display_name,
        groupId,
        unitCost,
        active: true,
      };
      materials.push(material);
      materialByCode.set(newCode, material);
      materialByName.set(cfg.display_name.trim().toLowerCase(), material);
    }
  }

  // Reload materials after creates when applying (stable ids)
  if (APPLY && createdMaterials.length > 0) {
    materials = (
      await db.prepare('SELECT id, code, name, group_id, unit_cost, active FROM materials ORDER BY id').all()
    ).results.map((r) => ({
      id: Number(r.id),
      code: String(r.code ?? ''),
      name: String(r.name ?? ''),
      groupId: r.group_id == null ? null : Number(r.group_id),
      unitCost: Number(r.unit_cost) || 0,
      active: Number(r.active) === 1,
    }));
    materialByCode.clear();
    materialByName.clear();
    for (const m of materials) {
      materialByCode.set(m.code, m);
      const key = m.name.trim().toLowerCase();
      if (key && !materialByName.has(key)) materialByName.set(key, m);
    }
  }

  /** @type {Map<number, { material_name: string, quantity: number }[]>} */
  const recipesByProduct = new Map();
  for (const row of recipesTurso.rows) {
    const productId = Number(row.product_id);
    const list = recipesByProduct.get(productId) ?? [];
    list.push({ material_name: String(row.material_name || '').trim(), quantity: Number(row.quantity) });
    recipesByProduct.set(productId, list);
  }

  let matchedProducts = 0;
  let writtenRecipes = 0;
  let skippedNoRecipe = 0;
  let missingProducts = 0;
  let ambiguousProducts = 0;
  let recipeErrors = 0;
  const samples = [];
  const now = Date.now();

  for (const prow of productsTurso.rows) {
    const tursoId = Number(prow.id);
    const name = String(prow.name ?? '');
    const costPrice = toUnitCost(prow.cost_price);
    const lines = recipesByProduct.get(tursoId) ?? [];
    if (lines.length === 0) {
      skippedNoRecipe += 1;
      continue;
    }

    const found = resolveProduct(name);
    if (!found) {
      missingProducts += 1;
      if (samples.length < 20) samples.push({ kind: 'missing-product', tursoId, name, costPrice });
      continue;
    }
    if (found.ambiguous) {
      ambiguousProducts += 1;
      if (samples.length < 20) samples.push({ kind: 'ambiguous-product', tursoId, name, candidates: found.ambiguous });
      continue;
    }

    /** @type {Map<number, number>} */
    const merged = new Map();
    let bad = false;
    for (const line of lines) {
      const qty = toQty(line.quantity);
      const mat = findMaterial(line.material_name);
      if (!qty || !mat) {
        bad = true;
        unresolvedMaterials.push(`${line.material_name || '?'}@${name}`);
        break;
      }
      // Dry-run tạo material tạm id âm; khi APPLY dùng id thật.
      const materialKey = mat.material.id;
      merged.set(materialKey, (merged.get(materialKey) ?? 0) + qty);
    }
    if (bad || merged.size === 0) {
      recipeErrors += 1;
      continue;
    }

    matchedProducts += 1;
    let computed = 0;
    for (const [materialId, quantity] of merged) {
      const m = materials.find((x) => x.id === materialId);
      computed += (m?.unitCost ?? 0) * quantity;
    }

    if (samples.length < 20) {
      samples.push({
        kind: 'recipe',
        productId: found.hit.id,
        name: found.hit.name,
        lines: merged.size,
        computedCost: computed,
        tursoCostPrice: costPrice,
        delta: costPrice == null ? null : computed - costPrice,
      });
    }

    if (APPLY) {
      await db.prepare('DELETE FROM product_materials WHERE product_id = ?').bind(found.hit.id).run();
      for (const [materialId, quantity] of merged) {
        await db
          .prepare('INSERT INTO product_materials (product_id, material_id, quantity) VALUES (?, ?, ?)')
          .bind(found.hit.id, materialId, quantity)
          .run();
        writtenRecipes += 1;
      }
      await db.prepare('UPDATE products SET updated_at = ? WHERE id = ?').bind(now, found.hit.id).run();
    } else {
      writtenRecipes += merged.size;
    }
  }

  console.log(
    JSON.stringify(
      {
        applied: APPLY,
        syncPrices: SYNC_PRICES,
        tursoProducts: productsTurso.rows.length,
        tursoRecipeRows: recipesTurso.rows.length,
        localProducts: localProducts.length,
        usedMaterialCodes: [...usedCodes].sort(),
        createdMaterials,
        updatedPrices,
        unresolvedMaterials: [...new Set(unresolvedMaterials)].slice(0, 40),
        matchedProducts,
        writtenRecipeLines: writtenRecipes,
        skippedNoRecipe,
        missingProducts,
        ambiguousProducts,
        recipeErrors,
        samples,
      },
      null,
      2,
    ),
  );
} finally {
  turso.close();
  await proxy.dispose();
}
