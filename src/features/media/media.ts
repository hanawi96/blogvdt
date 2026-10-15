import { and, asc, count, desc, eq, inArray, isNotNull, like, notInArray, or, type SQL } from 'drizzle-orm';
import { activityWrite, commitWrites, quotedLabel, type ActivityActor } from '../activity/log';
import type { AppDb } from '../../lib/db/client';
import { adminUsers, categories, media, posts, productCategories, productMedia, products, siteSettings } from '../../lib/db/schema';
import { routes } from '../../lib/routes';
import { detectImageType, displayFilename, imageSizeError, mediaKeyFromPublicUrl, mediaObjectKey, readRasterSize } from './files';
import { clampMediaPage, MEDIA_PAGE_SIZE, type MediaLibraryQuery } from './library';
import type { MediaItem, MediaUse } from './types';
import { collectMediaUses } from './uses';

export async function listMedia(db: AppDb): Promise<MediaItem[]> {
  const rows = await db
    .select({
      id: media.id,
      r2Key: media.r2Key,
      filename: media.filename,
      altText: media.altText,
      mimeType: media.mimeType,
      width: media.width,
      height: media.height,
      sizeBytes: media.sizeBytes,
      createdAt: media.createdAt,
    })
    .from(media)
    .orderBy(desc(media.createdAt), desc(media.id));
  return rows.map(toMediaItem);
}

function toMediaItem(row: {
  id: number;
  r2Key: string;
  filename: string;
  altText: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  sizeBytes: number;
  createdAt: number;
}): MediaItem {
  return {
    id: row.id,
    url: routes.media(row.r2Key),
    alt: row.altText,
    filename: row.filename,
    mimeType: row.mimeType,
    width: row.width,
    height: row.height,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt,
  };
}

export async function listMediaUses(db: AppDb) {
  const [library, postRows, productRows, albumRows, settings, avatars, categoryRows, productCategoryRows] = await Promise.all([
    db.select({ id: media.id, key: media.r2Key }).from(media),
    db.select({ id: posts.id, title: posts.title, coverMediaId: posts.coverMediaId, contentJson: posts.contentJson }).from(posts),
    db.select({ id: products.id, name: products.name, coverMediaId: products.coverMediaId }).from(products),
    db
      .select({ mediaId: productMedia.mediaId, productId: productMedia.productId, productName: products.name })
      .from(productMedia)
      .innerJoin(products, eq(products.id, productMedia.productId)),
    db
      .select({ key: siteSettings.key, value: siteSettings.value })
      .from(siteSettings)
      .where(or(eq(siteSettings.key, 'logo_media_id'), eq(siteSettings.key, 'favicon_media_id'), eq(siteSettings.key, 'og_media_id'))),
    db
      .select({ mediaId: adminUsers.avatarMediaId, userId: adminUsers.id, name: adminUsers.displayName })
      .from(adminUsers)
      .where(isNotNull(adminUsers.avatarMediaId)),
    db.select({ id: categories.id, name: categories.name, description: categories.description }).from(categories),
    db.select({ id: productCategories.id, name: productCategories.name, coverMediaId: productCategories.coverMediaId }).from(productCategories),
  ]);
  const setting = (key: string) => settings.find((row) => row.key === key)?.value ?? '';
  return collectMediaUses({
    media: library,
    posts: postRows,
    products: productRows,
    album: albumRows,
    logoId: setting('logo_media_id'),
    faviconId: setting('favicon_media_id'),
    ogImageId: setting('og_media_id'),
    avatars,
    categories: categoryRows,
    productCategoryCovers: productCategoryRows,
  });
}

export async function queryMediaLibrary(db: AppDb, query: MediaLibraryQuery): Promise<{
  items: MediaItem[];
  uses: Record<string, MediaUse[]>;
  total: number;
  page: number;
  pageSize: number;
}> {
  const pageSize = MEDIA_PAGE_SIZE;
  const allUses = await listMediaUses(db);
  const usedIds = Object.keys(allUses).map(Number).filter((id) => id > 0);
  if (query.usage === 'used' && usedIds.length === 0) {
    return { items: [], uses: {}, total: 0, page: 1, pageSize };
  }
  const filters: SQL[] = [];
  const needle = query.q.replace(/[%_]/g, '');
  if (needle) {
    const term = `%${needle}%`;
    const match = or(like(media.filename, term), like(media.altText, term));
    if (match) filters.push(match);
  }
  if (query.usage === 'used') filters.push(inArray(media.id, usedIds));
  if (query.usage === 'unused' && usedIds.length > 0) filters.push(notInArray(media.id, usedIds));
  const where = filters.length > 0 ? and(...filters) : undefined;
  const totalRows = await db.select({ value: count() }).from(media).where(where);
  const total = totalRows[0]?.value ?? 0;
  const page = clampMediaPage(query.page, total, pageSize);
  const order =
    query.sort === 'name'
      ? [asc(media.filename), asc(media.id)]
      : query.sort === 'size'
        ? [desc(media.sizeBytes), desc(media.id)]
        : [desc(media.createdAt), desc(media.id)];
  const rows = await db
    .select({
      id: media.id,
      r2Key: media.r2Key,
      filename: media.filename,
      altText: media.altText,
      mimeType: media.mimeType,
      width: media.width,
      height: media.height,
      sizeBytes: media.sizeBytes,
      createdAt: media.createdAt,
    })
    .from(media)
    .where(where)
    .orderBy(...order)
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const items = rows.map(toMediaItem);
  const uses: Record<string, MediaUse[]> = {};
  for (const item of items) {
    const list = allUses[String(item.id)];
    if (list) uses[String(item.id)] = list;
  }
  return { items, uses, total, page, pageSize };
}

const HEADER_BYTES = 4096;

type HeaderBucket = {
  get(key: string, options: { range: { offset: number; length: number } }): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
};

export async function mediaDimensionsByUrl(db: AppDb, urls: string[]) {
  const rows = await mediaSizeRows(db, urls);
  const sizes = new Map<string, { width: number; height: number }>();
  for (const [url, size] of rows) {
    if (size.width && size.height) sizes.set(url, { width: size.width, height: size.height });
  }
  return sizes;
}

async function mediaSizeRows(db: AppDb, urls: string[]) {
  const keys = new Map<string, string>();
  for (const url of urls) {
    const key = mediaKeyFromPublicUrl(url);
    if (key) keys.set(key, url);
  }
  const found = new Map<string, { width: number | null; height: number | null }>();
  const keyList = [...keys.keys()].slice(0, 40);
  if (keyList.length === 0) return found;
  const rows = await db
    .select({ r2Key: media.r2Key, width: media.width, height: media.height })
    .from(media)
    .where(inArray(media.r2Key, keyList));
  for (const row of rows) {
    const url = keys.get(row.r2Key);
    if (url) found.set(url, { width: row.width, height: row.height });
  }
  return found;
}

export async function layoutContentImages(db: AppDb, bucket: HeaderBucket | null, urls: string[]) {
  const known = await mediaSizeRows(db, urls);
  const missing = new Set(urls.filter((url) => !known.has(url)));
  const measured = await layoutImages(bucket, known);
  for (const url of measured.missing) missing.add(url);
  return { sizes: measured.sizes, missing };
}

export async function applyCoverMeasure<T extends { coverUrl: string | null; coverWidth: number | null; coverHeight: number | null }>(
  bucket: HeaderBucket | null,
  cards: T[],
): Promise<T[]> {
  const known = new Map<string, { width: number | null; height: number | null }>();
  for (const card of cards) {
    if (card.coverUrl) known.set(card.coverUrl, { width: card.coverWidth, height: card.coverHeight });
  }
  if (known.size === 0) return cards;
  const measured = await layoutImages(bucket, known);
  return cards.map((card) => {
    if (!card.coverUrl) return card;
    if (measured.missing.has(card.coverUrl)) return { ...card, coverUrl: null };
    const size = measured.sizes.get(card.coverUrl);
    return size ? { ...card, coverWidth: size.width, coverHeight: size.height } : card;
  });
}

async function layoutImages(bucket: HeaderBucket | null, known: Map<string, { width: number | null; height: number | null }>) {
  const sizes = new Map<string, { width: number; height: number }>();
  const missing = new Set<string>();
  const pending: string[] = [];
  for (const [url, size] of known) {
    if (size.width && size.height && size.width > 0 && size.height > 0) sizes.set(url, { width: size.width, height: size.height });
    else pending.push(url);
  }
  if (!bucket) return { sizes, missing };
  await Promise.all(
    pending.slice(0, 12).map(async (url) => {
      const measured = await measureImageFile(bucket, url);
      if (measured === 'missing') missing.add(url);
      else if (measured) sizes.set(url, measured);
    }),
  );
  return { sizes, missing };
}

async function measureImageFile(bucket: HeaderBucket, url: string): Promise<{ width: number; height: number } | null | 'missing'> {
  const key = mediaKeyFromPublicUrl(url);
  if (!key) return 'missing';
  try {
    const object = await bucket.get(key, { range: { offset: 0, length: HEADER_BYTES } });
    if (!object) return 'missing';
    return readRasterSize(new Uint8Array(await object.arrayBuffer()));
  } catch {
    return null;
  }
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
): Promise<{ ok: true; id: number; url: string; createdAt: number } | { ok: false; error: string }> {
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
    return { ok: true, id, url: routes.media(input.key), createdAt: now };
  } catch (error) {
    await bucket.delete(input.key);
    console.error(JSON.stringify({ event: 'media_insert_failed', name: error instanceof Error ? error.name : 'unknown' }));
    return { ok: false, error: 'Không lưu được ảnh.' };
  }
}

export async function updateMediaAlt(db: AppDb, id: number, altText: string): Promise<void> {
  await db.update(media).set({ altText: altText.slice(0, 200) }).where(eq(media.id, id));
}

export async function deleteMedia(
  db: AppDb,
  bucket: R2Bucket,
  id: number,
  actor?: ActivityActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rows = await db.select().from(media).where(eq(media.id, id)).limit(1);
  const item = rows[0];
  if (!item) return { ok: false, error: 'Không tìm thấy ảnh.' };
  const reason = await mediaInUse(db, item.id, item.r2Key);
  if (reason) return { ok: false, error: reason };
  await commitWrites(db, [
    db.delete(media).where(eq(media.id, id)),
    ...(actor
      ? [
          activityWrite(
            db,
            {
              actorId: actor.id,
              actorName: actor.name,
              action: 'media.delete',
              objectType: 'media',
              objectId: String(id),
              summary: `Đã xóa ảnh ${quotedLabel(item.filename, 'Không tên')}.`,
              createdAt: Date.now(),
            },
            true,
          ),
        ]
      : []),
  ]);
  await bucket.delete(item.r2Key);
  return { ok: true };
}

async function mediaInUse(db: AppDb, id: number, key: string): Promise<string | null> {
  const idText = String(id);
  const marker = `%/media/${key}%`;
  const [coverPost, coverProduct, album, content, settings, avatar, category, productCategory] = await Promise.all([
    db.select({ id: posts.id }).from(posts).where(eq(posts.coverMediaId, id)).limit(1),
    db.select({ id: products.id }).from(products).where(eq(products.coverMediaId, id)).limit(1),
    db.select({ productId: productMedia.productId }).from(productMedia).where(eq(productMedia.mediaId, id)).limit(1),
    db.select({ id: posts.id }).from(posts).where(like(posts.contentJson, marker)).limit(1),
    db
      .select({ value: siteSettings.value })
      .from(siteSettings)
      .where(or(eq(siteSettings.key, 'logo_media_id'), eq(siteSettings.key, 'favicon_media_id'), eq(siteSettings.key, 'og_media_id'))),
    db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.avatarMediaId, id)).limit(1),
    db.select({ id: categories.id }).from(categories).where(like(categories.description, marker)).limit(1),
    db.select({ id: productCategories.id }).from(productCategories).where(eq(productCategories.coverMediaId, id)).limit(1),
  ]);
  const usedInSettings = settings.some((row) => row.value === idText);
  if (coverPost[0] || coverProduct[0] || album[0] || content[0] || usedInSettings || avatar[0] || category[0] || productCategory[0]) {
    return 'Ảnh đang được dùng, chưa xóa được.';
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
