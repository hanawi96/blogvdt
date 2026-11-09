/**
 * Seed demo: 15 sản phẩm / mỗi danh mục sản phẩm trên D1 local.
 * Giá bán tính từ giá vốn công thức theo biên mục tiêu 60%, làm tròn lên 1.000 đ.
 * Chỉ chạy local — từ chối --remote.
 *
 *   npm run db:seed:demo-products
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PER_CATEGORY = 15;
const TARGET_MARGIN = 60;
const ROUND_STEP = 1000;
const NOW = Date.now();

const extraArgs = process.argv.slice(2);
if (extraArgs.some((arg) => arg === '--remote' || arg.startsWith('--remote'))) {
  console.error('Seed demo sản phẩm chỉ chạy D1 local. Không dùng --remote.');
  process.exit(1);
}

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptsDir, '..');
const wranglerJs = path.join(projectDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

function runSql(sql, label) {
  const file = path.join(os.tmpdir(), `blogvdt-demo-${Date.now()}-${Math.random().toString(16).slice(2)}.sql`);
  fs.writeFileSync(file, sql, 'utf8');
  const result = spawnSync(process.execPath, [wranglerJs, 'd1', 'execute', 'vong-dau-tam', '--local', '--file', file], {
    cwd: projectDir,
    encoding: 'utf8',
  });
  fs.unlinkSync(file);
  if (result.status !== 0) {
    console.error(result.stdout || '');
    console.error(result.stderr || '');
    throw new Error(label || 'Wrangler D1 execute thất bại.');
  }
  return result.stdout || '';
}

function queryJson(command) {
  const result = spawnSync(
    process.execPath,
    [wranglerJs, 'd1', 'execute', 'vong-dau-tam', '--local', '--json', '--command', command],
    { cwd: projectDir, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || '');
    throw new Error(`Query thất bại: ${command}`);
  }
  const parsed = JSON.parse(result.stdout);
  return parsed[0]?.results ?? [];
}

function sqlStr(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function suggestedPrice(cost) {
  if (!Number.isInteger(cost) || cost <= 0) return null;
  return Math.ceil((cost * 100) / ((100 - TARGET_MARGIN) * ROUND_STEP)) * ROUND_STEP;
}

function marginPercent(price, cost) {
  if (!price) return null;
  return Math.round(((price - cost) / price) * 100);
}

/** @param {Map<string, {id:number, unitCost:number}>} byCode */
function line(byCode, code, qty) {
  const material = byCode.get(code);
  if (!material) throw new Error(`Thiếu nguyên liệu code=${code}`);
  if (!Number.isInteger(qty) || qty < 1) throw new Error(`Số lượng không hợp lệ: ${code}×${qty}`);
  return { materialId: material.id, code, qty, unitCost: material.unitCost, lineCost: material.unitCost * qty };
}

function recipeCost(lines) {
  return lines.reduce((sum, item) => sum + item.lineCost, 0);
}

function ensureMaterials() {
  const now = NOW;
  // Bổ sung NL theo đúng chủ đề danh mục còn thiếu (không đụng NL rác test).
  runSql(
    `
INSERT OR IGNORE INTO materials (code, name, group_id, unit_cost, active, created_at, updated_at)
VALUES
  ('charm_ran', 'Charm rắn', 6, 55000, 1, ${now}, ${now}),
  ('charm_thanh_gia', 'Charm thánh giá', 6, 45000, 1, ${now}, ${now}),
  ('da_do_tu_nhien', 'Đá đỏ tự nhiên', 9, 2000, 1, ${now}, ${now}),
  ('day_ngu_sac', 'Dây ngũ sắc', 8, 2500, 1, ${now}, ${now}),
  ('chi_mau', 'Chỉ màu', 8, 1500, 1, ${now}, ${now});
`,
    'Thêm nguyên liệu demo theo danh mục',
  );
}

function loadMaterials() {
  const rows = queryJson(
    `SELECT id, code, unit_cost AS unitCost FROM materials WHERE active = 1 AND code NOT IN ('sgasdg','ikhikj')`,
  );
  /** @type {Map<string, {id:number, unitCost:number}>} */
  const byCode = new Map();
  for (const row of rows) byCode.set(row.code, { id: row.id, unitCost: row.unitCost });
  const required = [
    'chi_phi_lam_vong',
    'hat_dau_tam',
    'day_cuoc',
    'day_xo',
    'bi_bac_3ly',
    'bi_bac_5ly',
    'bi_bac_6ly',
    'bac_4ly',
    'charm_ngua',
    'charm_chuong',
    'charm_hoa_sen',
    'the_ten_be',
    'ho_phach',
    'hat_bo_de',
    'charm_ran',
    'charm_thanh_gia',
    'da_do_tu_nhien',
    'day_ngu_sac',
    'chi_mau',
  ];
  for (const code of required) {
    if (!byCode.has(code)) throw new Error(`Không tìm thấy nguyên liệu bắt buộc: ${code}`);
  }
  return byCode;
}

function loadCategories() {
  return queryJson(`SELECT id, name, slug FROM product_categories ORDER BY sort_order, id`);
}

function loadMediaIds() {
  const rows = queryJson(`SELECT id FROM media ORDER BY id`);
  return rows.map((row) => row.id);
}

/**
 * Công thức theo danh mục + biến thể index 0..14.
 * Luôn có chi phí làm vòng; hầu hết có hạt dâu tằm + dây.
 * @param {Map<string, {id:number, unitCost:number}>} m
 */
function buildRecipe(m, categorySlug, index) {
  const labor = () => line(m, 'chi_phi_lam_vong', 1);
  const hat = (n) => line(m, 'hat_dau_tam', n);
  const cuoc = () => line(m, 'day_cuoc', 1);
  const xo = () => line(m, 'day_xo', 1);
  const bi = (code, n = 1) => line(m, code, n);
  const biPick = ['bi_bac_3ly', 'bi_bac_5ly', 'bi_bac_6ly', 'bac_4ly'][index % 4];

  switch (categorySlug) {
    case 'vong-tron':
      return [labor(), hat(8 + (index % 7)), cuoc(), ...(index % 3 === 0 ? [bi(biPick)] : [])];
    case 'mix-charm-ngua-2026':
      return [labor(), hat(10 + (index % 5)), cuoc(), line(m, 'charm_ngua', 1), ...(index % 2 === 0 ? [bi(biPick)] : [])];
    case 'vong-co-gian':
      return [labor(), hat(9 + (index % 6)), xo(), ...(index % 2 === 0 ? [bi('bi_bac_3ly')] : [])];
    case 'mix-charm-ran':
      return [labor(), hat(10 + (index % 5)), cuoc(), line(m, 'charm_ran', 1), ...(index % 3 === 0 ? [bi(biPick)] : [])];
    case 'mix-charm-chuong':
      return [labor(), hat(10 + (index % 5)), cuoc(), line(m, 'charm_chuong', 1), ...(index % 2 ? [bi(biPick)] : [])];
    case 'mix-bi-bac':
      return [
        labor(),
        hat(8 + (index % 4)),
        cuoc(),
        bi(biPick, 1 + (index % 3)),
        ...(index % 4 === 0 ? [bi(biPick === 'bi_bac_3ly' ? 'bi_bac_5ly' : 'bi_bac_3ly')] : []),
      ];
    case 'mix-chi-mau-cac-loai':
      return [labor(), hat(10 + (index % 5)), line(m, 'chi_mau', 1 + (index % 2)), cuoc(), ...(index % 3 === 0 ? [bi('bi_bac_3ly')] : [])];
    case 'mix-hoa-sen':
      return [labor(), hat(10 + (index % 5)), cuoc(), line(m, 'charm_hoa_sen', 1), ...(index % 2 === 0 ? [bi(biPick)] : [])];
    case 'mix-hat-bo-de':
      return [labor(), hat(6 + (index % 4)), cuoc(), line(m, 'hat_bo_de', 6 + (index % 8)), ...(index % 3 === 0 ? [bi('bi_bac_3ly')] : [])];
    case 'mix-ho-phach':
      return [labor(), hat(8 + (index % 4)), cuoc(), line(m, 'ho_phach', 4 + (index % 7)), ...(index % 2 ? [bi(biPick)] : [])];
    case 'mix-thanh-gia':
      return [labor(), hat(10 + (index % 5)), cuoc(), line(m, 'charm_thanh_gia', 1), ...(index % 3 === 0 ? [bi(biPick)] : [])];
    case 'mix-the-ten-be':
      return [labor(), hat(10 + (index % 5)), cuoc(), line(m, 'the_ten_be', 1), ...(index % 2 === 0 ? [bi('bi_bac_3ly')] : [])];
    case 'mix-da-do-tu-nhien':
      return [labor(), hat(8 + (index % 4)), cuoc(), line(m, 'da_do_tu_nhien', 5 + (index % 6)), ...(index % 3 === 0 ? [bi(biPick)] : [])];
    case 'mix-day-ngu-sac':
      return [labor(), hat(10 + (index % 5)), line(m, 'day_ngu_sac', 1), ...(index % 2 ? [bi(biPick)] : [])];
    case 'vong-nguoi-lon':
      return [labor(), hat(14 + (index % 7)), cuoc(), bi(biPick, 1 + (index % 2)), ...(index % 4 === 0 ? [line(m, 'charm_chuong', 1)] : [])];
    case 'hat-dau-tam-mai-san':
      // Gói hạt / vòng hạt nhiều — ít charm.
      return [labor(), hat(20 + index * 2), ...(index % 5 === 0 ? [cuoc()] : []), ...(index % 4 === 0 ? [bi('bi_bac_3ly')] : [])];
    case 'bi-charm-bac':
      // Bán kèm bi/charm — ít hạt.
      return [
        labor(),
        hat(4 + (index % 3)),
        cuoc(),
        bi(biPick, 2 + (index % 3)),
        ...(index % 3 === 0 ? [line(m, 'charm_chuong', 1)] : index % 3 === 1 ? [line(m, 'charm_hoa_sen', 1)] : [line(m, 'charm_ngua', 1)]),
      ];
    case 'san-pham-ban-kem':
      return [
        labor(),
        hat(5 + (index % 4)),
        index % 2 === 0 ? cuoc() : xo(),
        ...(index % 3 === 0 ? [line(m, 'the_ten_be', 1)] : index % 3 === 1 ? [line(m, 'charm_chuong', 1)] : [bi('bi_bac_5ly', 2)]),
      ];
    default:
      return [labor(), hat(10 + (index % 5)), cuoc()];
  }
}

function cordTypeFor(categorySlug, index) {
  if (categorySlug === 'vong-co-gian') return 'Dây co giãn';
  if (categorySlug === 'mix-day-ngu-sac' || categorySlug === 'mix-chi-mau-cac-loai') {
    return index % 2 === 0 ? 'Dây rút' : 'Dây co giãn';
  }
  if (categorySlug === 'hat-dau-tam-mai-san' && index % 5 !== 0) return '';
  return index % 5 === 4 ? 'Dây co giãn' : 'Dây rút';
}

function productName(categoryName, index) {
  const suffixes = [
    'cơ bản',
    'tinh giản',
    'nhẹ nhàng',
    'đầy đủ charm',
    'điểm bi bạc',
    'size nhỏ',
    'size vừa',
    'tone ấm',
    'tone sáng',
    'mix dày',
    'mix thưa',
    'bản đặc biệt',
    'phiên bản mới',
    'quà thôi nôi',
    'quà đầy tháng',
  ];
  return `${categoryName} — ${suffixes[index]}`;
}

function descriptionFor(categoryName, lines, price, cost) {
  const parts = lines.map((item) => `${item.qty}×${item.code}`).join(', ');
  return `${categoryName} làm thủ công. Giá vốn ${cost.toLocaleString('vi-VN')} đ, giá bán ${price.toLocaleString('vi-VN')} đ (biên mục tiêu ~${TARGET_MARGIN}%). Công thức demo: ${parts}.`;
}

function main() {
  console.log('Đảm bảo nguyên liệu theo danh mục...');
  ensureMaterials();
  const materials = loadMaterials();
  const categories = loadCategories();
  const mediaIds = loadMediaIds();
  if (categories.length === 0) throw new Error('Chưa có danh mục sản phẩm.');

  console.log(`Danh mục: ${categories.length}. Media: ${mediaIds.length || 'không'}.`);
  console.log('Xóa sản phẩm cũ (giữ danh mục / nguyên liệu / bài / đơn)...');
  runSql(
    `
DELETE FROM product_media;
DELETE FROM product_materials;
DELETE FROM products;
`,
    'Xóa sản phẩm cũ',
  );

  /** @type {string[]} */
  const productValues = [];
  /** @type {string[]} */
  const recipeValues = [];
  let productId = 1;
  let okCount = 0;
  let minMargin = 100;
  let maxMargin = 0;

  for (const category of categories) {
    for (let index = 0; index < PER_CATEGORY; index += 1) {
      const lines = buildRecipe(materials, category.slug, index);
      // Gộp qty nếu trùng materialId (tránh PK trùng).
      /** @type {Map<number, typeof lines[0]>} */
      const merged = new Map();
      for (const item of lines) {
        const prev = merged.get(item.materialId);
        if (prev) {
          prev.qty += item.qty;
          prev.lineCost = prev.unitCost * prev.qty;
        } else {
          merged.set(item.materialId, { ...item });
        }
      }
      const recipe = [...merged.values()];
      const cost = recipeCost(recipe);
      const price = suggestedPrice(cost);
      if (price === null) throw new Error(`Không tính được giá cho ${category.slug} #${index + 1}, cost=${cost}`);
      const margin = marginPercent(price, cost);
      if (margin === null || margin < TARGET_MARGIN) {
        throw new Error(`Biên ${margin}% < ${TARGET_MARGIN}% cho ${category.slug} #${index + 1} (cost=${cost}, price=${price})`);
      }
      minMargin = Math.min(minMargin, margin);
      maxMargin = Math.max(maxMargin, margin);

      const name = productName(category.name, index);
      const slug = `demo-${category.slug}-${String(index + 1).padStart(2, '0')}`;
      const cordType = cordTypeFor(category.slug, index);
      const stock = 20 + ((index * 7 + category.id * 3) % 80);
      const rating = 40 + ((index * 3 + category.id) % 11); // 4.0 → 5.0
      const featured = index < 2 ? 1 : 0;
      const status = index === PER_CATEGORY - 1 ? 'inactive' : 'active';
      const comparePrice = index % 4 === 1 ? price + 20000 + (index % 3) * 10000 : null;
      const cover = mediaIds.length ? mediaIds[(productId + index) % mediaIds.length] : null;
      const desc = descriptionFor(category.name, recipe, price, cost);
      const seoTitle = name.slice(0, 180);
      const meta = `Vòng dâu tằm thủ công thuộc nhóm ${category.name}.`.slice(0, 300);

      productValues.push(
        `(${productId}, ${category.id}, ${sqlStr(name)}, ${sqlStr(slug)}, ${price}, ${comparePrice === null ? 'NULL' : comparePrice}, ${sqlStr(cordType)}, ${sqlStr(desc)}, ${cover === null ? 'NULL' : cover}, '[]', ${sqlStr(status)}, ${featured}, ${index + 1}, ${stock}, ${rating}, ${sqlStr(seoTitle)}, ${sqlStr(meta)}, ${NOW}, ${NOW})`,
      );

      for (const item of recipe) {
        recipeValues.push(`(${productId}, ${item.materialId}, ${item.qty})`);
      }

      productId += 1;
      okCount += 1;
    }
  }

  const expected = categories.length * PER_CATEGORY;
  if (okCount !== expected) throw new Error(`Số sản phẩm ${okCount} ≠ kỳ vọng ${expected}`);

  console.log(`Chèn ${okCount} sản phẩm + ${recipeValues.length} dòng công thức...`);
  // Chia batch để tránh file SQL quá lớn / giới hạn.
  const chunk = 40;
  for (let i = 0; i < productValues.length; i += chunk) {
    const slice = productValues.slice(i, i + chunk);
    runSql(
      `
INSERT INTO products (
  id, category_id, name, slug, price, compare_price, cord_type, description, cover_media_id,
  options_json, status, is_featured, sort_order, stock_qty, rating, seo_title, meta_description, created_at, updated_at
) VALUES
${slice.join(',\n')};
`,
      `Insert products ${i + 1}-${i + slice.length}`,
    );
  }

  for (let i = 0; i < recipeValues.length; i += 200) {
    const slice = recipeValues.slice(i, i + 200);
    runSql(
      `
INSERT INTO product_materials (product_id, material_id, quantity) VALUES
${slice.join(',\n')};
`,
      `Insert recipes ${i + 1}-${i + slice.length}`,
    );
  }

  const counts = queryJson(`
SELECT
  (SELECT COUNT(*) FROM products) AS products,
  (SELECT COUNT(*) FROM product_materials) AS recipes,
  (SELECT COUNT(DISTINCT category_id) FROM products) AS categories_used,
  (SELECT MIN(cnt) FROM (SELECT COUNT(*) AS cnt FROM products GROUP BY category_id)) AS min_per_cat,
  (SELECT MAX(cnt) FROM (SELECT COUNT(*) AS cnt FROM products GROUP BY category_id)) AS max_per_cat
`);
  const check = counts[0];
  console.log('Kết quả:', check);
  console.log(`Biên lợi nhuận thực tế sau làm tròn: ${minMargin}% … ${maxMargin}% (mục tiêu ≥ ${TARGET_MARGIN}%).`);

  if (check.products !== expected) throw new Error(`Sai số sản phẩm: ${check.products}`);
  if (check.min_per_cat !== PER_CATEGORY || check.max_per_cat !== PER_CATEGORY) {
    throw new Error(`Mỗi danh mục phải đúng ${PER_CATEGORY} SP.`);
  }

  // Spot-check: giá ≥ vốn / 0.4 (biên 60%)
  const samples = queryJson(`
SELECT p.id, p.name, p.price,
  (SELECT COALESCE(SUM(pm.quantity * m.unit_cost), 0)
   FROM product_materials pm JOIN materials m ON m.id = pm.material_id
   WHERE pm.product_id = p.id) AS cost
FROM products p
ORDER BY p.id
LIMIT 5
`);
  for (const row of samples) {
    const margin = marginPercent(row.price, row.cost);
    const expect = suggestedPrice(row.cost);
    if (row.price !== expect) throw new Error(`SP #${row.id} giá ${row.price} ≠ đề xuất ${expect} (vốn ${row.cost})`);
    if (margin < TARGET_MARGIN) throw new Error(`SP #${row.id} biên ${margin}%`);
    console.log(`  ✓ #${row.id} vốn ${row.cost} → giá ${row.price} (biên ${margin}%)`);
  }

  console.log(`Xong: ${expected} sản phẩm demo (${categories.length} danh mục × ${PER_CATEGORY}).`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
