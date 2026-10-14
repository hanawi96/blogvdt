import { desc, eq, inArray, like, or } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { media, posts, productMedia, products, siteSettings } from '../../lib/db/schema';
import { routes } from '../../lib/routes';
import { isMediaSrc } from '../posts/content';
import { detectImageType, displayFilename, imageSizeError, mediaObjectKey } from './files';

export async function listMedia(db: AppDb) {
  const rows = await db
    .select({
      id: media.id,
      r2Key: media.r2Key,
      filename: media.filename,
      altText: media.altText,
      mimeType: media.mimeType,
      width: media.width,
      height: media.height,
      createdAt: media.createdAt,
    })
    .from(media)
    .orderBy(desc(media.createdAt), desc(media.id));
  return rows.map((row) => ({ ...row, url: routes.media(row.r2Key) }));
}

export async function mediaDimensionsByUrl(db: AppDb, urls: string[]) {
  const keys = new Map<string, string>();
  for (const url of urls) {
    if (!isMediaSrc(url)) continue;
    keys.set(url.slice('/media/'.length), url);
  }
  const keyList = [...keys.keys()].slice(0, 40);
  if (keyList.length === 0) return new Map<string, { width: number; height: number }>();
  const rows = await db
    .select({ r2Key: media.r2Key, width: media.width, height: media.height })
    .from(media)
    .where(inArray(media.r2Key, keyList));
  const sizes = new Map<string, { width: number; height: number }>();
  for (const row of rows) {
    if (!row.width || !row.height || row.width < 1 || row.height < 1) continue;
    const url = keys.get(row.r2Key);
    if (url) sizes.set(url, { width: row.width, height: row.height });
  }
  return sizes;
}

export async function getMediaFile(db: AppDb, id: number) {
  const rows = await db
    .select({
      r2Key: media.r2Key,
      altText: media.altText,
      width: media.width,
      height: media.height,
    })
    .from(media)
    .where(eq(media.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    url: routes.media(row.r2Key),
    alt: row.altText,
    width: row.width,
    height: row.height,
  };
}

export async function saveMedia(
  db: AppDb,
  bucket: R2Bucket,
  input: {
    bytes: Uint8Array;
    key: string;
    filename: string;
    altText: string;
    mimeType: string;
    width: number | null;
    height: number | null;
  },
  now = Date.now(),
): Promise<{ ok: true; id: number; url: string } | { ok: false; error: string }> {
  await bucket.put(input.key, input.bytes, { httpMetadata: { contentType: input.mimeType } });
  try {
    const inserted = await db
      .insert(media)
      .values({
        r2Key: input.key,
        filename: input.filename,
        altText: input.altText,
        mimeType: input.mimeType,
        sizeBytes: input.bytes.byteLength,
        width: input.width,
        height: input.height,
        createdAt: now,
      })
      .returning({ id: media.id });
    const id = inserted[0]?.id;
    if (!id) throw new Error('missing media id');
    return { ok: true, id, url: routes.media(input.key) };
  } catch (error) {
    await bucket.delete(input.key);
    console.error(JSON.stringify({ event: 'media_insert_failed', name: error instanceof Error ? error.name : 'unknown' }));
    return { ok: false, error: 'Không lưu được ảnh.' };
  }
}

export async function updateMediaAlt(db: AppDb, id: number, altText: string): Promise<void> {
  await db.update(media).set({ altText: altText.slice(0, 200) }).where(eq(media.id, id));
}

export async function deleteMedia(db: AppDb, bucket: R2Bucket, id: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const rows = await db.select().from(media).where(eq(media.id, id)).limit(1);
  const item = rows[0];
  if (!item) return { ok: false, error: 'Không tìm thấy ảnh.' };
  const reason = await mediaInUse(db, item.id, item.r2Key);
  if (reason) return { ok: false, error: reason };
  await db.delete(media).where(eq(media.id, id));
  await bucket.delete(item.r2Key);
  return { ok: true };
}

async function mediaInUse(db: AppDb, id: number, key: string): Promise<string | null> {
  const idText = String(id);
  const [coverPost, coverProduct, album, content, settings] = await Promise.all([
    db.select({ id: posts.id }).from(posts).where(eq(posts.coverMediaId, id)).limit(1),
    db.select({ id: products.id }).from(products).where(eq(products.coverMediaId, id)).limit(1),
    db.select({ productId: productMedia.productId }).from(productMedia).where(eq(productMedia.mediaId, id)).limit(1),
    db.select({ id: posts.id }).from(posts).where(like(posts.contentJson, `%${key}%`)).limit(1),
    db
      .select({ value: siteSettings.value })
      .from(siteSettings)
      .where(or(eq(siteSettings.key, 'logo_media_id'), eq(siteSettings.key, 'favicon_media_id'))),
  ]);
  const usedInSettings = settings.some((row) => row.value === idText);
  if (coverPost[0] || coverProduct[0] || album[0] || content[0] || usedInSettings) {
    return 'Ảnh đang được dùng trong bài viết, sản phẩm hoặc cài đặt.';
  }
  return null;
}

export async function parseUpload(form: FormData) {
  const file = form.get('file');
  if (!(file instanceof File)) return { ok: false as const, error: 'Chọn một ảnh.' };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sizeError = imageSizeError(bytes.byteLength);
  if (sizeError) return { ok: false as const, error: sizeError };
  const kind = detectImageType(bytes);
  if (!kind) return { ok: false as const, error: 'Chỉ nhận ảnh JPEG, PNG hoặc WebP.' };
  const alt = form.get('alt');
  return {
    ok: true as const,
    bytes,
    key: mediaObjectKey(kind.extension),
    filename: displayFilename(file.name),
    altText: typeof alt === 'string' ? alt.trim().slice(0, 200) : '',
    mimeType: kind.mimeType,
    width: dimension(form.get('width')),
    height: dimension(form.get('height')),
  };
}

function dimension(value: FormDataEntryValue | null): number | null {
  if (typeof value !== 'string' || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 8000) return null;
  return number;
}
