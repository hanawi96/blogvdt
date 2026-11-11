/**
 * Tạo card/thumb còn thiếu trên D1+R2 local.
 * Chỉ chạy local — không hỗ trợ --remote.
 *
 * Usage: npm run media:backfill:local
 */
import { getPlatformProxy } from 'wrangler';

const MEDIA_CARD_SIZE = 800;
const MEDIA_THUMB_SIZE = 96;
const LIMIT = 20;
const ORIGINAL_KEY_RE =
  /^original\/(\d{4}\/\d{2})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[a-z0-9]+$/i;
const LEGACY_KEY_RE =
  /^(\d{4}\/\d{2})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[a-z0-9]+$/i;

if (process.argv.includes('--remote')) {
  console.error('Backfill script chỉ chạy local. Không dùng --remote.');
  process.exit(1);
}

function variantKeys(r2Key) {
  const modern = ORIGINAL_KEY_RE.exec(r2Key);
  if (modern) {
    return { card: `card/${modern[1]}/${modern[2]}.webp`, thumb: `thumb/${modern[1]}/${modern[2]}.webp` };
  }
  const legacy = LEGACY_KEY_RE.exec(r2Key);
  if (!legacy) return null;
  return { card: `card/${legacy[1]}/${legacy[2]}.webp`, thumb: `thumb/${legacy[1]}/${legacy[2]}.webp` };
}

async function createSquareWebp(images, bytes, size) {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const output = await images.input(stream).transform({ width: size, height: size, fit: 'cover' }).output({ format: 'image/webp' });
  return new Uint8Array(await output.response().arrayBuffer());
}

const proxy = await getPlatformProxy({ persist: true });
try {
  const db = proxy.env.DB;
  const bucket = proxy.env.MEDIA;
  const images = proxy.env.IMAGES;
  if (!db || !bucket || !images) {
    console.error('Thiếu binding DB, MEDIA hoặc IMAGES trong môi trường local.');
    process.exit(1);
  }

  const listed = await db
    .prepare(
      `SELECT id, r2_key, card_r2_key, thumb_r2_key
       FROM media
       WHERE card_r2_key IS NULL OR thumb_r2_key IS NULL
       ORDER BY id
       LIMIT ?`,
    )
    .bind(LIMIT)
    .all();
  const rows = listed.results ?? [];

  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const keys = variantKeys(row.r2_key);
    if (!keys) {
      skipped += 1;
      console.warn(`Bỏ qua id=${row.id}: key không nhận dạng (${row.r2_key})`);
      continue;
    }
    const object = await bucket.get(row.r2_key);
    if (!object) {
      skipped += 1;
      console.warn(`Bỏ qua id=${row.id}: không thấy object R2`);
      continue;
    }
    const bytes = new Uint8Array(await object.arrayBuffer());
    let cardKey = row.card_r2_key;
    let thumbKey = row.thumb_r2_key;
    try {
      if (!cardKey) {
        const cardBytes = await createSquareWebp(images, bytes, MEDIA_CARD_SIZE);
        await bucket.put(keys.card, cardBytes, { httpMetadata: { contentType: 'image/webp' } });
        cardKey = keys.card;
      }
      if (!thumbKey) {
        const thumbBytes = await createSquareWebp(images, bytes, MEDIA_THUMB_SIZE);
        await bucket.put(keys.thumb, thumbBytes, { httpMetadata: { contentType: 'image/webp' } });
        thumbKey = keys.thumb;
      }
    } catch (error) {
      skipped += 1;
      console.warn(`Bỏ qua id=${row.id}: ${error instanceof Error ? error.message : 'variant failed'}`);
      continue;
    }
    await db
      .prepare(`UPDATE media SET card_r2_key = ?, thumb_r2_key = ? WHERE id = ?`)
      .bind(cardKey, thumbKey, row.id)
      .run();
    updated += 1;
    console.log(`OK id=${row.id} → ${cardKey}`);
  }

  const remaining = await db
    .prepare(`SELECT COUNT(*) AS value FROM media WHERE card_r2_key IS NULL OR thumb_r2_key IS NULL`)
    .first();
  console.log(
    JSON.stringify({
      processed: rows.length,
      updated,
      skipped,
      remaining: Number(remaining?.value ?? 0),
    }),
  );
} finally {
  await proxy.dispose();
}
