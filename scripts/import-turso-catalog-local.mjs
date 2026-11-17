/**
 * Import danh mục + sản phẩm (+ ảnh cover) từ Turso → D1/R2 local.
 * Chỉ local — từ chối --remote.
 *
 * Cần env:
 *   TURSO_URL=libsql://...
 *   TURSO_TOKEN=...
 *
 *   npm install --no-save @libsql/client
 *   node scripts/import-turso-catalog-local.mjs
 */
import { randomUUID } from 'node:crypto';
import { getPlatformProxy } from 'wrangler';

const MEDIA_CARD_SIZE = 800;
const MEDIA_THUMB_SIZE = 96;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // nới hơn upload CMS (2MB) cho ảnh cũ
const FETCH_CONCURRENCY = 4;

if (process.argv.includes('--remote')) {
  console.error('Import Turso catalog chỉ chạy local. Không dùng --remote.');
  process.exit(1);
}

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

const WEIGHT_NONE = new Set([
  'bi, charm bạc',
  'hạt dâu tằm mài sẵn',
  'san pham ban kem',
  'sản phẩm bán kèm',
]);

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

function uniqueSlug(base, used) {
  let stem = slugify(base) || 'muc';
  let slug = stem;
  let n = 2;
  while (used.has(slug)) {
    slug = `${stem}-${n}`.slice(0, 180);
    n += 1;
  }
  used.add(slug);
  return slug;
}

function weightScaleForCategory(name) {
  const key = String(name || '')
    .trim()
    .toLowerCase();
  if (WEIGHT_NONE.has(key)) return 'none';
  return 'baby';
}

function cordType(value) {
  if (value === 'elastic' || value === 'adjustable' || value === 'other') return value;
  return 'adjustable';
}

function toIntPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

function toRating(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(50, Math.max(0, Math.round(n * 10)));
}

function detectImageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: '.jpg' };
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { mimeType: 'image/png', extension: '.png' };
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { mimeType: 'image/webp', extension: '.webp' };
  }
  return null;
}

function mediaObjectKeys(extension, now = new Date(), id = randomUUID()) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const folder = `${year}/${month}`;
  return {
    id,
    original: `original/${folder}/${id}${extension}`,
    card: `card/${folder}/${id}.webp`,
    thumb: `thumb/${folder}/${id}.webp`,
  };
}

function displayFilename(urlOrName) {
  try {
    const pathname = new URL(urlOrName).pathname;
    const base = pathname.split('/').pop() || 'anh';
    return base.replace(/[^\w.\- ]+/g, '').trim().slice(0, 80) || 'anh';
  } catch {
    return 'anh';
  }
}

async function createSquareWebp(images, bytes, size) {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const output = await images
    .input(stream)
    .transform({ width: size, height: size, fit: 'cover' })
    .output({ format: 'image/webp' });
  return new Uint8Array(await output.response().arrayBuffer());
}

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let index = 0;
  async function run() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
}

async function downloadImage(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength <= 0) throw new Error('empty');
  if (buf.byteLength > MAX_IMAGE_BYTES) throw new Error(`too large ${buf.byteLength}`);
  const kind = detectImageType(buf);
  if (!kind) throw new Error('unsupported type');
  return { bytes: buf, kind };
}

async function insertMedia(db, bucket, images, url, altText) {
  const { bytes, kind } = await downloadImage(url);
  const keys = mediaObjectKeys(kind.extension);
  let cardKey = null;
  let thumbKey = null;
  await bucket.put(keys.original, bytes, { httpMetadata: { contentType: kind.mimeType } });
  if (images) {
    try {
      const cardBytes = await createSquareWebp(images, bytes, MEDIA_CARD_SIZE);
      await bucket.put(keys.card, cardBytes, { httpMetadata: { contentType: 'image/webp' } });
      cardKey = keys.card;
      const thumbBytes = await createSquareWebp(images, bytes, MEDIA_THUMB_SIZE);
      await bucket.put(keys.thumb, thumbBytes, { httpMetadata: { contentType: 'image/webp' } });
      thumbKey = keys.thumb;
    } catch {
      // Local IMAGES có thể thiếu — original vẫn dùng được; backfill sau.
    }
  }
  const now = Date.now();
  const result = await db
    .prepare(
      `INSERT INTO media (r2_key, card_r2_key, thumb_r2_key, filename, alt_text, mime_type, size_bytes, width, height, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
       RETURNING id`,
    )
    .bind(
      keys.original,
      cardKey,
      thumbKey,
      displayFilename(url),
      String(altText || '').slice(0, 200),
      kind.mimeType,
      bytes.byteLength,
      now,
    )
    .first();
  if (!result?.id) throw new Error('media insert failed');
  return Number(result.id);
}

const { createClient } = await import('@libsql/client');
const turso = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
const proxy = await getPlatformProxy({ persist: true });

try {
  const db = proxy.env.DB;
  const bucket = proxy.env.MEDIA;
  const images = proxy.env.IMAGES;
  if (!db || !bucket) {
    console.error('Thiếu binding DB hoặc MEDIA local.');
    process.exit(1);
  }

  console.log('Đọc Turso…');
  const categories = (
    await turso.execute(`
    SELECT id, name, description, display_order, is_active, image_url, is_featured
    FROM categories
    ORDER BY display_order ASC, id ASC
  `)
  ).rows;

  const products = (
    await turso.execute(`
    SELECT id, name, price, description, image_url, category_id, is_active,
           original_price, rating, stock_quantity, is_featured, featured_order, bracelet_type
    FROM products
    ORDER BY id ASC
  `)
  ).rows;

  const links = (
    await turso.execute(`
    SELECT product_id, category_id, is_primary, display_order
    FROM product_categories
    ORDER BY is_primary DESC, display_order ASC, id ASC
  `)
  ).rows;

  /** @type {Map<number, number>} */
  const primaryCat = new Map();
  for (const row of links) {
    const pid = Number(row.product_id);
    if (primaryCat.has(pid)) continue;
    if (Number(row.is_primary) === 1) primaryCat.set(pid, Number(row.category_id));
  }
  for (const row of links) {
    const pid = Number(row.product_id);
    if (!primaryCat.has(pid)) primaryCat.set(pid, Number(row.category_id));
  }

  console.log(`Turso: ${categories.length} danh mục, ${products.length} sản phẩm`);

  console.log('Xóa catalog local (products / product_categories / product_media / product_materials)…');
  await db.batch([
    db.prepare('DELETE FROM product_media'),
    db.prepare('DELETE FROM product_materials'),
    db.prepare('DELETE FROM products'),
    db.prepare('DELETE FROM product_categories'),
  ]);

  const usedCatSlugs = new Set();
  const usedProductSlugs = new Set();
  /** @type {Map<number, number>} */
  const catMap = new Map();
  const now = Date.now();
  let catOk = 0;
  let catImgFail = 0;

  console.log('Import danh mục…');
  for (const [index, cat] of categories.entries()) {
    const oldId = Number(cat.id);
    const name = String(cat.name || '').trim();
    if (!name) continue;
    const slug = uniqueSlug(name, usedCatSlugs);
    const description = cat.description == null ? '' : String(cat.description);
    const sortOrder = Number.isFinite(Number(cat.display_order)) ? Number(cat.display_order) : index;
    const status = Number(cat.is_active) === 1 ? 'active' : 'inactive';
    const weightScale = weightScaleForCategory(name);
    let coverMediaId = null;
    if (cat.image_url) {
      try {
        coverMediaId = await insertMedia(db, bucket, images, String(cat.image_url), name);
      } catch (error) {
        catImgFail += 1;
        console.warn(`  [cat img] ${name}: ${error instanceof Error ? error.message : error}`);
      }
    }
    const inserted = await db
      .prepare(
        `INSERT INTO product_categories
          (name, slug, description, cover_media_id, sort_order, weight_scale, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
      )
      .bind(name, slug, description, coverMediaId, sortOrder, weightScale, status, now, now)
      .first();
    if (!inserted?.id) throw new Error(`Không insert danh mục ${name}`);
    catMap.set(oldId, Number(inserted.id));
    catOk += 1;
    console.log(`  ✓ [${catOk}/${categories.length}] ${name} → #${inserted.id}`);
  }

  console.log('Tải ảnh sản phẩm…');
  const imageJobs = products
    .filter((p) => p.image_url)
    .map((p) => ({ id: Number(p.id), url: String(p.image_url), name: String(p.name || '') }));
  /** @type {Map<number, number>} */
  const productMediaMap = new Map();
  let prodImgFail = 0;
  await mapPool(imageJobs, FETCH_CONCURRENCY, async (job) => {
    try {
      const mediaId = await insertMedia(db, bucket, images, job.url, job.name);
      productMediaMap.set(job.id, mediaId);
    } catch (error) {
      prodImgFail += 1;
      console.warn(`  [product img] #${job.id} ${job.name}: ${error instanceof Error ? error.message : error}`);
    }
  });
  console.log(`Ảnh SP: ${productMediaMap.size} ok, ${prodImgFail} lỗi`);

  console.log('Import sản phẩm…');
  let prodOk = 0;
  let prodSkip = 0;
  for (const product of products) {
    const oldId = Number(product.id);
    const name = String(product.name || '').trim();
    if (!name) {
      prodSkip += 1;
      continue;
    }
    const oldCatId = primaryCat.get(oldId) ?? (product.category_id == null ? null : Number(product.category_id));
    const newCatId = oldCatId != null ? catMap.get(oldCatId) ?? null : null;
    const slug = uniqueSlug(name, usedProductSlugs);
    const price = toIntPrice(product.price);
    const compareRaw = product.original_price == null ? null : toIntPrice(product.original_price);
    const comparePrice = compareRaw != null && compareRaw > price ? compareRaw : null;
    const description = product.description == null ? '' : String(product.description);
    const status = Number(product.is_active) === 1 ? 'active' : 'inactive';
    const isFeatured = Number(product.is_featured) === 1 ? 1 : 0;
    const sortOrder =
      product.featured_order != null && Number.isFinite(Number(product.featured_order))
        ? Number(product.featured_order)
        : oldId;
    const stockQty = Math.max(0, Math.round(Number(product.stock_quantity) || 0));
    const rating = toRating(product.rating);
    const cord = cordType(product.bracelet_type);
    const coverMediaId = productMediaMap.get(oldId) ?? null;
    const inserted = await db
      .prepare(
        `INSERT INTO products
          (category_id, name, slug, price, compare_price, cord_type, description, cover_media_id,
           options_json, status, is_featured, sort_order, stock_qty, rating, seo_title, meta_description,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
         RETURNING id`,
      )
      .bind(
        newCatId,
        name,
        slug,
        price,
        comparePrice,
        cord,
        description,
        coverMediaId,
        status,
        isFeatured,
        sortOrder,
        stockQty,
        rating,
        now,
        now,
      )
      .first();
    if (!inserted?.id) throw new Error(`Không insert SP ${name}`);
    if (coverMediaId) {
      await db
        .prepare(`INSERT INTO product_media (product_id, media_id, sort_order) VALUES (?, ?, 0)`)
        .bind(inserted.id, coverMediaId)
        .run();
    }
    prodOk += 1;
    if (prodOk % 20 === 0 || prodOk === products.length) {
      console.log(`  … ${prodOk}/${products.length}`);
    }
  }

  const summary = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM product_categories) AS categories,
         (SELECT COUNT(*) FROM products) AS products,
         (SELECT COUNT(*) FROM products WHERE cover_media_id IS NOT NULL) AS products_with_cover,
         (SELECT COUNT(*) FROM product_categories WHERE cover_media_id IS NOT NULL) AS categories_with_cover`,
    )
    .first();

  console.log(
    JSON.stringify(
      {
        imported: { categories: catOk, products: prodOk, skippedProducts: prodSkip },
        imageFailures: { categories: catImgFail, products: prodImgFail },
        local: summary,
      },
      null,
      2,
    ),
  );
} finally {
  await proxy.dispose();
  turso.close();
}
