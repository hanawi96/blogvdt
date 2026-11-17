/**
 * Đồng bộ catalog local → production (nhanh).
 * - Đọc D1/R2 local qua getPlatformProxy
 * - Ghi R2/D1 production qua Cloudflare REST API (song song), không spawn Wrangler từng object
 *
 *   node scripts/sync-catalog-to-remote.mjs --apply
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';

const APPLY = process.argv.includes('--apply');
const ACCOUNT_ID = '6732e495e6dc332a4d51e0aba6c0408a';
const DB_ID = 'b98c2657-e991-42e8-bba3-a797452437b2';
const BUCKET = 'vong-dau-tam-media';
const UPLOAD_CONCURRENCY = 12;
const API = 'https://api.cloudflare.com/client/v4';

function sqlString(value) {
  if (value == null) return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlInt(value) {
  if (value == null || Number.isNaN(Number(value))) return 'NULL';
  return String(Math.trunc(Number(value)));
}

function readWranglerOauthToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN.trim();
  const configPath = join(
    process.env.USERPROFILE || process.env.HOME || '',
    'AppData/Roaming/xdg.config/.wrangler/config/default.toml',
  );
  const text = readFileSync(configPath, 'utf8');
  const match = text.match(/oauth_token\s*=\s*"([^"]+)"/);
  if (!match) throw new Error('Không tìm thấy oauth_token Wrangler. Chạy wrangler login hoặc set CLOUDFLARE_API_TOKEN.');
  return match[1];
}

async function mapPool(items, concurrency, worker) {
  const out = new Array(items.length);
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i;
      i += 1;
      out[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, () => run()));
  return out;
}

async function withRetry(label, fn, attempts = 4) {
  let last;
  for (let n = 1; n <= attempts; n += 1) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`  retry ${n}/${attempts} ${label}: ${msg}`);
      await new Promise((r) => setTimeout(r, 400 * n));
    }
  }
  throw last;
}

function createApi(token) {
  async function d1(sql, params = []) {
    const res = await fetch(`${API}/accounts/${ACCOUNT_ID}/d1/database/${DB_ID}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(`D1 ${res.status}: ${JSON.stringify(json.errors || json)}`);
    }
    return json.result?.[0]?.results ?? [];
  }

  async function d1Batch(statements) {
    // Cloudflare D1 HTTP: một request một SQL; gom bằng Promise pool.
    const results = [];
    await mapPool(statements, 6, async (sql) => {
      results.push(await d1(sql));
    });
    return results;
  }

  async function r2Put(key, bytes, contentType) {
    // Slash trong key giữ nguyên (không encode /).
    const url = `${API}/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects/${key}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': contentType || 'application/octet-stream',
      },
      body: bytes,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`R2 PUT ${key} → ${res.status} ${text.slice(0, 200)}`);
    }
  }

  async function r2Delete(key) {
    const url = `${API}/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects/${key}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok && res.status !== 404) {
      const text = await res.text();
      throw new Error(`R2 DELETE ${key} → ${res.status} ${text.slice(0, 200)}`);
    }
  }

  return { d1, d1Batch, r2Put, r2Delete };
}

const token = readWranglerOauthToken();
const api = createApi(token);
const proxy = await getPlatformProxy({ persist: true });

try {
  const db = proxy.env.DB;
  const bucket = proxy.env.MEDIA;
  if (!db || !bucket) throw new Error('Thiếu binding DB/MEDIA local');

  const categories = (
    await db
      .prepare(
        `SELECT id, name, slug, description, cover_media_id, sort_order, weight_scale, status, created_at, updated_at
         FROM product_categories ORDER BY sort_order ASC, id ASC`,
      )
      .all()
  ).results;

  const products = (
    await db
      .prepare(
        `SELECT id, category_id, name, slug, price, compare_price, cord_type, description, cover_media_id,
                options_json, status, is_featured, sort_order, stock_qty, rating, seo_title, meta_description,
                created_at, updated_at
         FROM products ORDER BY id ASC`,
      )
      .all()
  ).results;

  const album = (
    await db.prepare(`SELECT product_id, media_id, sort_order FROM product_media ORDER BY product_id, sort_order, media_id`).all()
  ).results;

  const mediaIdSet = new Set();
  for (const row of categories) if (row.cover_media_id != null) mediaIdSet.add(Number(row.cover_media_id));
  for (const row of products) if (row.cover_media_id != null) mediaIdSet.add(Number(row.cover_media_id));
  for (const row of album) mediaIdSet.add(Number(row.media_id));
  const mediaIds = [...mediaIdSet];

  /** @type {any[]} */
  const mediaRows = [];
  for (let i = 0; i < mediaIds.length; i += 80) {
    const chunk = mediaIds.slice(i, i + 80);
    const rows = (
      await db
        .prepare(
          `SELECT id, r2_key, card_r2_key, thumb_r2_key, filename, alt_text, mime_type, size_bytes, width, height, created_at
           FROM media WHERE id IN (${chunk.map(() => '?').join(',')})`,
        )
        .bind(...chunk)
        .all()
    ).results;
    mediaRows.push(...rows);
  }

  console.log(
    JSON.stringify(
      {
        mode: APPLY ? 'APPLY' : 'DRY-RUN',
        local: {
          categories: categories.length,
          products: products.length,
          productMedia: album.length,
          media: mediaRows.length,
        },
      },
      null,
      2,
    ),
  );

  if (!APPLY) {
    console.log('\nChạy thật: node scripts/sync-catalog-to-remote.mjs --apply');
    process.exit(0);
  }

  // Smoke-test quyền API trước khi đụng catalog.
  await withRetry('api smoke', async () => {
    const rows = await api.d1('SELECT 1 AS ok');
    if (!rows[0]?.ok && rows[0]?.ok !== 1) {
      // D1 may return ok:1
    }
  });

  console.log('1) Xóa catalog production…');
  await api.d1('DELETE FROM product_media');
  await api.d1('DELETE FROM product_materials');
  await api.d1('DELETE FROM products');
  await api.d1('DELETE FROM product_categories');

  console.log('2) Đọc bytes media local…');
  /** @type {Map<number, {row:any, objects:{key:string, bytes:Uint8Array, mime:string}[]}>} */
  const prepared = new Map();
  await mapPool(mediaRows, 8, async (row) => {
    const objects = [];
    const keys = [
      { key: row.r2_key, mime: row.mime_type },
      row.card_r2_key ? { key: row.card_r2_key, mime: 'image/webp' } : null,
      row.thumb_r2_key ? { key: row.thumb_r2_key, mime: 'image/webp' } : null,
    ].filter(Boolean);
    for (const item of keys) {
      const obj = await withRetry(`local get ${item.key}`, async () => {
        const got = await bucket.get(item.key);
        if (!got) throw new Error('missing');
        return new Uint8Array(await got.arrayBuffer());
      });
      objects.push({ key: item.key, bytes: obj, mime: item.mime });
    }
    prepared.set(Number(row.id), { row, objects });
  });
  console.log(`   prepared ${prepared.size} media`);

  console.log('3) Upload R2 production (song song)…');
  let uploaded = 0;
  const uploadJobs = [...prepared.values()].flatMap((item) => item.objects);
  await mapPool(uploadJobs, UPLOAD_CONCURRENCY, async (job, index) => {
    await withRetry(`r2 ${job.key}`, () => api.r2Put(job.key, job.bytes, job.mime));
    uploaded += 1;
    if ((index + 1) % 30 === 0 || index + 1 === uploadJobs.length) {
      console.log(`   uploaded ${index + 1}/${uploadJobs.length}`);
    }
  });

  console.log('4) Insert media rows…');
  /** @type {Map<number, number>} */
  const mediaMap = new Map();
  for (const row of mediaRows) {
    const existing = await api.d1(`SELECT id FROM media WHERE r2_key = ${sqlString(row.r2_key)} LIMIT 1`);
    let remoteId = existing[0]?.id ?? null;
    if (!remoteId) {
      await api.d1(
        `INSERT INTO media (r2_key, card_r2_key, thumb_r2_key, filename, alt_text, mime_type, size_bytes, width, height, created_at)
         VALUES (
           ${sqlString(row.r2_key)},
           ${sqlString(row.card_r2_key)},
           ${sqlString(row.thumb_r2_key)},
           ${sqlString(row.filename)},
           ${sqlString(row.alt_text ?? '')},
           ${sqlString(row.mime_type)},
           ${sqlInt(row.size_bytes)},
           ${sqlInt(row.width)},
           ${sqlInt(row.height)},
           ${sqlInt(row.created_at)}
         )`,
      );
      const created = await api.d1(`SELECT id FROM media WHERE r2_key = ${sqlString(row.r2_key)} LIMIT 1`);
      remoteId = created[0]?.id ?? null;
    }
    if (!remoteId) throw new Error(`media insert failed local#${row.id}`);
    mediaMap.set(Number(row.id), Number(remoteId));
  }

  console.log('5) Insert danh mục…');
  /** @type {Map<number, number>} */
  const catMap = new Map();
  for (const row of categories) {
    const cover = row.cover_media_id == null ? null : mediaMap.get(Number(row.cover_media_id)) ?? null;
    await api.d1(
      `INSERT INTO product_categories
        (name, slug, description, cover_media_id, sort_order, weight_scale, status, created_at, updated_at)
       VALUES (
         ${sqlString(row.name)},
         ${sqlString(row.slug)},
         ${sqlString(row.description ?? '')},
         ${sqlInt(cover)},
         ${sqlInt(row.sort_order)},
         ${sqlString(row.weight_scale || 'baby')},
         ${sqlString(row.status || 'active')},
         ${sqlInt(row.created_at)},
         ${sqlInt(row.updated_at)}
       )`,
    );
    const created = await api.d1(`SELECT id FROM product_categories WHERE slug = ${sqlString(row.slug)} LIMIT 1`);
    if (!created[0]?.id) throw new Error(`category ${row.slug}`);
    catMap.set(Number(row.id), Number(created[0].id));
  }

  console.log('6) Insert sản phẩm…');
  /** @type {Map<number, number>} */
  const productMap = new Map();
  for (const [index, row] of products.entries()) {
    const categoryId = row.category_id == null ? null : catMap.get(Number(row.category_id)) ?? null;
    const cover = row.cover_media_id == null ? null : mediaMap.get(Number(row.cover_media_id)) ?? null;
    await api.d1(
      `INSERT INTO products
        (category_id, name, slug, price, compare_price, cord_type, description, cover_media_id,
         options_json, status, is_featured, sort_order, stock_qty, rating, seo_title, meta_description,
         created_at, updated_at)
       VALUES (
         ${sqlInt(categoryId)},
         ${sqlString(row.name)},
         ${sqlString(row.slug)},
         ${sqlInt(row.price)},
         ${sqlInt(row.compare_price)},
         ${sqlString(row.cord_type || '')},
         ${sqlString(row.description ?? '')},
         ${sqlInt(cover)},
         ${sqlString(row.options_json || '[]')},
         ${sqlString(row.status || 'active')},
         ${sqlInt(row.is_featured ? 1 : 0)},
         ${sqlInt(row.sort_order)},
         ${sqlInt(row.stock_qty)},
         ${sqlInt(row.rating)},
         ${sqlString(row.seo_title)},
         ${sqlString(row.meta_description)},
         ${sqlInt(row.created_at)},
         ${sqlInt(row.updated_at)}
       )`,
    );
    const created = await api.d1(`SELECT id FROM products WHERE slug = ${sqlString(row.slug)} LIMIT 1`);
    if (!created[0]?.id) throw new Error(`product ${row.slug}`);
    productMap.set(Number(row.id), Number(created[0].id));
    if ((index + 1) % 40 === 0 || index + 1 === products.length) {
      console.log(`   products ${index + 1}/${products.length}`);
    }
  }

  console.log('7) Insert product_media…');
  for (const row of album) {
    const productId = productMap.get(Number(row.product_id));
    const mediaId = mediaMap.get(Number(row.media_id));
    if (!productId || !mediaId) continue;
    await api.d1(
      `INSERT OR IGNORE INTO product_media (product_id, media_id, sort_order)
       VALUES (${sqlInt(productId)}, ${sqlInt(mediaId)}, ${sqlInt(row.sort_order ?? 0)})`,
    );
  }

  const summary = (
    await api.d1(`
    SELECT
      (SELECT COUNT(*) FROM product_categories) AS categories,
      (SELECT COUNT(*) FROM products) AS products,
      (SELECT COUNT(*) FROM products WHERE cover_media_id IS NOT NULL) AS products_with_cover,
      (SELECT COUNT(*) FROM product_categories WHERE cover_media_id IS NOT NULL) AS categories_with_cover,
      (SELECT COUNT(*) FROM product_media) AS product_media
  `)
  )[0];

  console.log(JSON.stringify({ uploadedObjects: uploaded, mediaMapped: mediaMap.size, remote: summary }, null, 2));
} finally {
  await proxy.dispose();
}
