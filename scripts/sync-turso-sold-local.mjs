/**
 * Đồng bộ products.purchases (Turso) → products.sold_base (D1 local).
 * Chỉ local — từ chối --remote.
 *
 * Map theo tên (không dùng id: import catalog không giữ id Turso).
 * Ưu tiên tên khớp exact (trim), rồi slugify(name) khớp slug hoặc slugify(name local).
 *
 * Cần env:
 *   TURSO_URL=libsql://...
 *   TURSO_TOKEN=...
 *
 *   npm install --no-save @libsql/client
 *   node scripts/sync-turso-sold-local.mjs           # dry-run
 *   node scripts/sync-turso-sold-local.mjs --apply   # ghi local
 */
import { getPlatformProxy } from 'wrangler';

if (process.argv.includes('--remote')) {
  console.error('Sync sold_base chỉ chạy local. Không dùng --remote.');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');
const TURSO_URL = process.env.TURSO_URL || process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_TOKEN || process.env.TURSO_AUTH_TOKEN;
if (!TURSO_URL || !TURSO_TOKEN) {
  console.error('Thiếu TURSO_URL và TURSO_TOKEN.');
  process.exit(1);
}

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

function toSoldBase(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.trunc(n), 10_000_000);
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

  console.log(APPLY ? 'Chế độ APPLY (ghi D1 local).' : 'Chế độ dry-run (không ghi). Thêm --apply để ghi.');
  console.log('Đọc Turso products.purchases…');
  const source = (
    await turso.execute(`
      SELECT id, name, purchases
      FROM products
      ORDER BY id ASC
    `)
  ).rows;

  const local = (
    await db
      .prepare('SELECT id, name, slug, sold_base FROM products ORDER BY id ASC')
      .all()
  ).results;

  /** @type {Map<string, { id: number, name: string, slug: string, sold_base: number }>} */
  const byName = new Map();
  /** @type {Map<string, { id: number, name: string, slug: string, sold_base: number }[]>} */
  const bySlugKey = new Map();
  for (const row of local) {
    const item = {
      id: Number(row.id),
      name: String(row.name ?? ''),
      slug: String(row.slug ?? ''),
      sold_base: Number(row.sold_base) || 0,
    };
    const nameKey = item.name.trim().toLowerCase();
    if (nameKey) byName.set(nameKey, item);
    const keys = new Set([item.slug, slugify(item.name)].filter(Boolean));
    for (const key of keys) {
      const list = bySlugKey.get(key) ?? [];
      if (!list.some((entry) => entry.id === item.id)) list.push(item);
      bySlugKey.set(key, list);
    }
  }

  function resolveLocal(name) {
    const trimmed = name.trim();
    const exact = byName.get(trimmed.toLowerCase());
    if (exact) return { hit: exact, via: 'name' };
    const key = slugify(trimmed);
    if (!key) return null;
    const list = bySlugKey.get(key) ?? [];
    if (list.length === 1) return { hit: list[0], via: 'slug' };
    if (list.length > 1) return { ambiguous: list.map((item) => ({ id: item.id, name: item.name })) };
    return null;
  }

  let matched = 0;
  let changed = 0;
  let skippedSame = 0;
  let missing = 0;
  let ambiguous = 0;
  const samples = [];

  for (const row of source) {
    const tursoId = Number(row.id);
    const name = String(row.name ?? '');
    const next = toSoldBase(row.purchases);
    const found = resolveLocal(name);
    if (!found) {
      missing += 1;
      if (samples.length < 15) samples.push({ kind: 'missing', tursoId, name, purchases: next });
      continue;
    }
    if (found.ambiguous) {
      ambiguous += 1;
      if (samples.length < 15) samples.push({ kind: 'ambiguous', tursoId, name, purchases: next, candidates: found.ambiguous });
      continue;
    }
    const hit = found.hit;
    matched += 1;
    if (hit.sold_base === next) {
      skippedSame += 1;
      continue;
    }
    changed += 1;
    if (samples.length < 15) {
      samples.push({
        kind: 'update',
        id: hit.id,
        name: hit.name,
        from: hit.sold_base,
        to: next,
        via: found.via,
      });
    }
    if (APPLY) {
      await db
        .prepare('UPDATE products SET sold_base = ?, updated_at = ? WHERE id = ?')
        .bind(next, Date.now(), hit.id)
        .run();
    }
  }

  console.log(
    JSON.stringify(
      {
        tursoRows: source.length,
        localRows: local.length,
        matched,
        changed,
        skippedSame,
        missing,
        ambiguous,
        applied: APPLY,
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
