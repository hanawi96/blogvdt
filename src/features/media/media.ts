import { and, asc, count, desc, eq, inArray, isNotNull, isNull, like, notInArray, or, type SQL } from 'drizzle-orm';
import { activityWrite, commitWrites, quotedLabel, type ActivityActor } from '../activity/log';
import { optionalImagesBinding } from '../../lib/cloudflare/env';
import type { AppDb } from '../../lib/db/client';
import { listFeedbackMediaIds } from '../feedback/feedback';
import { adminUsers, categories, media, posts, productCategories, productMedia, products, siteSettings } from '../../lib/db/schema';
import { routes } from '../../lib/routes';
import {
  createSquareWebp,
  detectImageType,
  displayFilename,
  imageSizeError,
  MEDIA_CARD_SIZE,
  MEDIA_THUMB_SIZE,
  mediaKeyFromPublicUrl,
  mediaObjectKeys,
  readRasterSize,
  variantKeysForStoredKey,
} from './files';
import { clampMediaPage, MEDIA_PAGE_SIZE, type MediaLibraryQuery } from './library';
import type { MediaItem, MediaUse } from './types';
import { collectMediaUses, extractMediaKeysFromText } from './uses';

export async function listMedia(db: AppDb): Promise<MediaItem[]> {
  const rows = await db
    .select({
      id: media.id,
      r2Key: media.r2Key,
      cardR2Key: media.cardR2Key,
      thumbR2Key: media.thumbR2Key,
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

/** Ảnh theo id (cover/avatar đã chọn) — seed MediaPicker, không dump cả thư viện. */
export async function listMediaByIds(
  db: AppDb,
  ids: ReadonlyArray<number | string | null | undefined>,
): Promise<MediaItem[]> {
  const unique = [
    ...new Set(
      ids
        .map((value) => Number(value))
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  ];
  if (unique.length === 0) return [];
  const rows = await db
    .select({
      id: media.id,
      r2Key: media.r2Key,
      cardR2Key: media.cardR2Key,
      thumbR2Key: media.thumbR2Key,
      filename: media.filename,
      altText: media.altText,
      mimeType: media.mimeType,
      width: media.width,
      height: media.height,
      sizeBytes: media.sizeBytes,
      createdAt: media.createdAt,
    })
    .from(media)
    .where(inArray(media.id, unique));
  const byId = new Map(rows.map((row) => [row.id, toMediaItem(row)]));
  return unique.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
}

function toMediaItem(row: {
  id: number;
  r2Key: string;
  cardR2Key: string | null;
  thumbR2Key: string | null;
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
    cardUrl: row.cardR2Key ? routes.media(row.cardR2Key) : null,
    thumbUrl: row.thumbR2Key ? routes.media(row.thumbR2Key) : null,
    alt: row.altText,
    filename: row.filename,
    mimeType: row.mimeType,
    width: row.width,
    height: row.height,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt,
  };
}

/** Tập id ảnh đang được tham chiếu (cover/album/cài đặt + key nhúng trong nội dung). */
export async function listUsedMediaIds(db: AppDb): Promise<number[]> {
  const [postCovers, productCovers, albumRows, settings, avatars, productCategoryCovers, embedPosts, embedCategories, feedbackIds] =
    await Promise.all([
      db.select({ id: posts.coverMediaId }).from(posts).where(isNotNull(posts.coverMediaId)),
      db.select({ id: products.coverMediaId }).from(products).where(isNotNull(products.coverMediaId)),
      db.select({ id: productMedia.mediaId }).from(productMedia),
      db
        .select({ value: siteSettings.value })
        .from(siteSettings)
        .where(or(eq(siteSettings.key, 'logo_media_id'), eq(siteSettings.key, 'favicon_media_id'), eq(siteSettings.key, 'og_media_id'))),
      db.select({ id: adminUsers.avatarMediaId }).from(adminUsers).where(isNotNull(adminUsers.avatarMediaId)),
      db
        .select({ id: productCategories.coverMediaId })
        .from(productCategories)
        .where(isNotNull(productCategories.coverMediaId)),
      db
        .select({ contentJson: posts.contentJson })
        .from(posts)
        .where(like(posts.contentJson, '%/media/%')),
      db
        .select({ description: categories.description })
        .from(categories)
        .where(like(categories.description, '%/media/%')),
      listFeedbackMediaIds(db),
    ]);

  const used = new Set<number>();
  for (const row of postCovers) if (row.id != null) used.add(row.id);
  for (const row of productCovers) if (row.id != null) used.add(row.id);
  for (const row of albumRows) used.add(row.id);
  for (const row of avatars) if (row.id != null) used.add(row.id);
  for (const row of productCategoryCovers) if (row.id != null) used.add(row.id);
  for (const id of feedbackIds) used.add(id);
  for (const row of settings) {
    const id = Number(row.value);
    if (Number.isInteger(id) && id > 0) used.add(id);
  }

  const embedKeys = new Set<string>();
  for (const row of embedPosts) for (const key of extractMediaKeysFromText(row.contentJson)) embedKeys.add(key);
  for (const row of embedCategories) {
    if (row.description) for (const key of extractMediaKeysFromText(row.description)) embedKeys.add(key);
  }
  if (embedKeys.size > 0) {
    const keyList = [...embedKeys];
    const byKey = await db
      .select({ id: media.id, r2Key: media.r2Key, cardR2Key: media.cardR2Key, thumbR2Key: media.thumbR2Key })
      .from(media)
      .where(or(inArray(media.r2Key, keyList), inArray(media.cardR2Key, keyList), inArray(media.thumbR2Key, keyList)));
    for (const row of byKey) used.add(row.id);
  }

  return [...used];
}

/** Uses chỉ cho các ảnh đang xem (một trang thư viện). */
export async function listMediaUsesForItems(db: AppDb, items: { id: number; key: string }[]) {
  if (items.length === 0) return {} as Record<string, MediaUse[]>;
  const ids = items.map((item) => item.id);
  // Tránh OR nhiều LIKE '%/media/{uuid}%' — D1/SQLite báo "LIKE or GLOB pattern too complex".
  // Lọc rộng '%/media/%' rồi khớp key trong collectMediaUses.
  const [postRows, productRows, albumRows, settings, avatars, categoryRows, productCategoryRows] = await Promise.all([
    db
      .select({ id: posts.id, title: posts.title, coverMediaId: posts.coverMediaId, contentJson: posts.contentJson })
      .from(posts)
      .where(or(inArray(posts.coverMediaId, ids), like(posts.contentJson, '%/media/%'))),
    db
      .select({ id: products.id, name: products.name, coverMediaId: products.coverMediaId })
      .from(products)
      .where(inArray(products.coverMediaId, ids)),
    db
      .select({ mediaId: productMedia.mediaId, productId: productMedia.productId, productName: products.name })
      .from(productMedia)
      .innerJoin(products, eq(products.id, productMedia.productId))
      .where(inArray(productMedia.mediaId, ids)),
    db
      .select({ key: siteSettings.key, value: siteSettings.value })
      .from(siteSettings)
      .where(or(eq(siteSettings.key, 'logo_media_id'), eq(siteSettings.key, 'favicon_media_id'), eq(siteSettings.key, 'og_media_id'))),
    db
      .select({ mediaId: adminUsers.avatarMediaId, userId: adminUsers.id, name: adminUsers.displayName })
      .from(adminUsers)
      .where(inArray(adminUsers.avatarMediaId, ids)),
    db
      .select({ id: categories.id, name: categories.name, description: categories.description })
      .from(categories)
      .where(like(categories.description, '%/media/%')),
    db
      .select({ id: productCategories.id, name: productCategories.name, coverMediaId: productCategories.coverMediaId })
      .from(productCategories)
      .where(inArray(productCategories.coverMediaId, ids)),
  ]);
  const setting = (key: string) => settings.find((row) => row.key === key)?.value ?? '';
  return collectMediaUses({
    media: items,
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
  const usedIds =
    query.usage === 'used' || query.usage === 'unused' ? await listUsedMediaIds(db) : null;
  if (query.usage === 'used' && usedIds && usedIds.length === 0) {
    return { items: [], uses: {}, total: 0, page: 1, pageSize };
  }
  const filters: SQL[] = [];
  const needle = query.q.replace(/[%_]/g, '');
  if (needle) {
    const term = `%${needle}%`;
    const match = or(like(media.filename, term), like(media.altText, term));
    if (match) filters.push(match);
  }
  if (query.usage === 'used' && usedIds) filters.push(inArray(media.id, usedIds));
  if (query.usage === 'unused' && usedIds && usedIds.length > 0) filters.push(notInArray(media.id, usedIds));
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
      cardR2Key: media.cardR2Key,
      thumbR2Key: media.thumbR2Key,
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
  const uses = await listMediaUsesForItems(
    db,
    rows.map((row) => ({ id: row.id, key: row.r2Key })),
  );
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
    cardKey: string;
    thumbKey: string;
    filename: string;
    altText: string;
    mimeType: string;
    width: number | null;
    height: number | null;
  },
  now = Date.now(),
): Promise<
  | { ok: true; id: number; url: string; cardUrl: string | null; thumbUrl: string | null; createdAt: number }
  | { ok: false; error: string }
> {
  const images = optionalImagesBinding();
  if (!images) {
    console.error(JSON.stringify({ event: 'media_variant_skipped', reason: 'images_binding_missing' }));
  }
  const [cardBytes, thumbBytes] = images
    ? await Promise.all([
        createSquareWebp(images, input.bytes, MEDIA_CARD_SIZE),
        createSquareWebp(images, input.bytes, MEDIA_THUMB_SIZE),
      ])
    : [null, null];
  const cardKey = cardBytes ? input.cardKey : null;
  const thumbKey = thumbBytes ? input.thumbKey : null;

  await bucket.put(input.key, input.bytes, { httpMetadata: { contentType: input.mimeType } });
  await Promise.all([
    cardBytes && cardKey
      ? bucket.put(cardKey, cardBytes, { httpMetadata: { contentType: 'image/webp' } })
      : Promise.resolve(),
    thumbBytes && thumbKey
      ? bucket.put(thumbKey, thumbBytes, { httpMetadata: { contentType: 'image/webp' } })
      : Promise.resolve(),
  ]);

  try {
    const inserted = await db
      .insert(media)
      .values({
        r2Key: input.key,
        cardR2Key: cardKey,
        thumbR2Key: thumbKey,
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
    return {
      ok: true,
      id,
      url: routes.media(input.key),
      cardUrl: cardKey ? routes.media(cardKey) : null,
      thumbUrl: thumbKey ? routes.media(thumbKey) : null,
      createdAt: now,
    };
  } catch (error) {
    await Promise.all([
      bucket.delete(input.key).catch(() => undefined),
      cardKey ? bucket.delete(cardKey).catch(() => undefined) : undefined,
      thumbKey ? bucket.delete(thumbKey).catch(() => undefined) : undefined,
    ]);
    console.error(JSON.stringify({ event: 'media_insert_failed', name: error instanceof Error ? error.name : 'unknown' }));
    return { ok: false, error: 'Không lưu được ảnh.' };
  }
}

export async function updateMediaAlt(db: AppDb, id: number, altText: string): Promise<void> {
  await db.update(media).set({ altText: altText.slice(0, 200) }).where(eq(media.id, id));
}

/**
 * Thay nội dung ảnh cho một media id: ghi đè bytes mới lên đúng r2Key cũ (và tạo lại card/thumb
 * trên đúng key cũ nếu có). Giữ nguyên id + mọi r2 key nên tất cả nơi tham chiếu (theo id hoặc
 * theo URL nhúng trong nội dung) tự dùng ảnh mới mà không phải sửa gì. ETag R2 đổi theo bytes
 * mới nên trình duyệt/CDN tải lại bản mới.
 */
export async function replaceMedia(
  db: AppDb,
  bucket: R2Bucket,
  id: number,
  parsed: { bytes: Uint8Array; filename: string; mimeType: string; width: number | null; height: number | null },
  actor?: ActivityActor,
): Promise<
  | { ok: true; url: string; cardUrl: string | null; thumbUrl: string | null; filename: string; mimeType: string; width: number | null; height: number | null; sizeBytes: number }
  | { ok: false; error: string }
> {
  const rows = await db.select().from(media).where(eq(media.id, id)).limit(1);
  const item = rows[0];
  if (!item) return { ok: false, error: 'Không tìm thấy ảnh.' };

  // Ghi đè bản gốc trên đúng key cũ (giữ nguyên URL /media/{r2Key}).
  await bucket.put(item.r2Key, parsed.bytes, { httpMetadata: { contentType: parsed.mimeType } });

  // Tạo lại card/thumb nếu Images binding sẵn sàng. Dùng key cũ khi đã có; suy ra key mới nếu chưa có.
  const images = optionalImagesBinding();
  const variantKeys = variantKeysForStoredKey(item.r2Key);
  let cardKey = item.cardR2Key;
  let thumbKey = item.thumbR2Key;
  if (images) {
    const targetCardKey = item.cardR2Key ?? variantKeys?.card ?? null;
    const targetThumbKey = item.thumbR2Key ?? variantKeys?.thumb ?? null;
    const [cardBytes, thumbBytes] = await Promise.all([
      targetCardKey ? createSquareWebp(images, parsed.bytes, MEDIA_CARD_SIZE) : Promise.resolve(null),
      targetThumbKey ? createSquareWebp(images, parsed.bytes, MEDIA_THUMB_SIZE) : Promise.resolve(null),
    ]);
    if (cardBytes && targetCardKey) {
      await bucket.put(targetCardKey, cardBytes, { httpMetadata: { contentType: 'image/webp' } });
      cardKey = targetCardKey;
    }
    if (thumbBytes && targetThumbKey) {
      await bucket.put(targetThumbKey, thumbBytes, { httpMetadata: { contentType: 'image/webp' } });
      thumbKey = targetThumbKey;
    }
  }

  try {
    await commitWrites(db, [
      db
        .update(media)
        .set({
          cardR2Key: cardKey,
          thumbR2Key: thumbKey,
          filename: parsed.filename,
          mimeType: parsed.mimeType,
          sizeBytes: parsed.bytes.byteLength,
          width: parsed.width,
          height: parsed.height,
        })
        .where(eq(media.id, id)),
      ...(actor
        ? [
            activityWrite(
              db,
              {
                actorId: actor.id,
                actorName: actor.name,
                action: 'media.replace',
                objectType: 'media',
                objectId: String(id),
                summary: `Đã thay ảnh ${quotedLabel(parsed.filename, 'Không tên')}.`,
                createdAt: Date.now(),
              },
              true,
            ),
          ]
        : []),
    ]);
  } catch (error) {
    console.error(JSON.stringify({ event: 'media_replace_failed', name: error instanceof Error ? error.name : 'unknown' }));
    return { ok: false, error: 'Không thay được ảnh.' };
  }

  return {
    ok: true,
    url: routes.media(item.r2Key),
    cardUrl: cardKey ? routes.media(cardKey) : null,
    thumbUrl: thumbKey ? routes.media(thumbKey) : null,
    filename: parsed.filename,
    mimeType: parsed.mimeType,
    width: parsed.width,
    height: parsed.height,
    sizeBytes: parsed.bytes.byteLength,
  };
}

export type MediaRef = { url: string; alt: string; width: number | null; height: number | null };

/** Lấy nhanh url/alt/kích thước cho một nhóm media id (ví dụ ảnh hero/OG của landing). */
export async function mediaMapByIds(db: AppDb, ids: number[]): Promise<Map<number, MediaRef>> {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  const map = new Map<number, MediaRef>();
  if (unique.length === 0) return map;
  const rows = await db
    .select({ id: media.id, key: media.r2Key, alt: media.altText, width: media.width, height: media.height })
    .from(media)
    .where(inArray(media.id, unique));
  for (const row of rows) map.set(row.id, { url: routes.media(row.key), alt: row.alt ?? '', width: row.width, height: row.height });
  return map;
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
  await Promise.all([
    bucket.delete(item.r2Key).catch(() => undefined),
    item.cardR2Key ? bucket.delete(item.cardR2Key).catch(() => undefined) : undefined,
    item.thumbR2Key ? bucket.delete(item.thumbR2Key).catch(() => undefined) : undefined,
  ]);
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

export const MEDIA_VARIANT_BACKFILL_LIMIT = 20;

/** Tạo card/thumb còn thiếu cho ảnh cũ. Chỉ xử lý tối đa `limit` ảnh mỗi lần. */
export async function backfillMediaVariants(
  db: AppDb,
  bucket: R2Bucket,
  limit = MEDIA_VARIANT_BACKFILL_LIMIT,
): Promise<{ ok: true; processed: number; updated: number; skipped: number; remaining: number } | { ok: false; error: string }> {
  const images = optionalImagesBinding();
  if (!images) return { ok: false, error: 'Thiếu binding Images (IMAGES).' };
  const take = Math.max(1, Math.min(limit, MEDIA_VARIANT_BACKFILL_LIMIT));
  const rows = await db
    .select({
      id: media.id,
      r2Key: media.r2Key,
      cardR2Key: media.cardR2Key,
      thumbR2Key: media.thumbR2Key,
    })
    .from(media)
    .where(or(isNull(media.cardR2Key), isNull(media.thumbR2Key)))
    .orderBy(asc(media.id))
    .limit(take);
  const remainingRows = await db
    .select({ value: count() })
    .from(media)
    .where(or(isNull(media.cardR2Key), isNull(media.thumbR2Key)));
  const remainingBefore = remainingRows[0]?.value ?? 0;

  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const keys = variantKeysForStoredKey(row.r2Key);
    if (!keys) {
      skipped += 1;
      continue;
    }
    const needCard = !row.cardR2Key;
    const needThumb = !row.thumbR2Key;
    if (!needCard && !needThumb) {
      skipped += 1;
      continue;
    }
    const object = await bucket.get(row.r2Key);
    if (!object) {
      skipped += 1;
      continue;
    }
    const bytes = new Uint8Array(await object.arrayBuffer());
    let cardKey = row.cardR2Key;
    let thumbKey = row.thumbR2Key;
    if (needCard) {
      const cardBytes = await createSquareWebp(images, bytes, MEDIA_CARD_SIZE);
      if (cardBytes) {
        await bucket.put(keys.card, cardBytes, { httpMetadata: { contentType: 'image/webp' } });
        cardKey = keys.card;
      }
    }
    if (needThumb) {
      const thumbBytes = await createSquareWebp(images, bytes, MEDIA_THUMB_SIZE);
      if (thumbBytes) {
        await bucket.put(keys.thumb, thumbBytes, { httpMetadata: { contentType: 'image/webp' } });
        thumbKey = keys.thumb;
      }
    }
    if (cardKey === row.cardR2Key && thumbKey === row.thumbR2Key) {
      skipped += 1;
      continue;
    }
    await db.update(media).set({ cardR2Key: cardKey, thumbR2Key: thumbKey }).where(eq(media.id, row.id));
    updated += 1;
  }

  return {
    ok: true,
    processed: rows.length,
    updated,
    skipped,
    remaining: Math.max(0, remainingBefore - updated),
  };
}

/** Validate file cho thao tác thay ảnh (giữ nguyên key cũ nên không sinh object key mới). */
export async function parseReplaceUpload(form: FormData) {
  const file = form.get('file');
  if (!(file instanceof File)) return { ok: false as const, error: 'Chọn một ảnh.' };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sizeError = imageSizeError(bytes.byteLength);
  if (sizeError) return { ok: false as const, error: sizeError };
  const kind = detectImageType(bytes);
  if (!kind) return { ok: false as const, error: 'Chỉ nhận ảnh JPEG, PNG hoặc WebP.' };
  return {
    ok: true as const,
    bytes,
    filename: displayFilename(file.name),
    mimeType: kind.mimeType,
    width: dimension(form.get('width')),
    height: dimension(form.get('height')),
  };
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
  const keys = mediaObjectKeys(kind.extension);
  return {
    ok: true as const,
    bytes,
    key: keys.original,
    cardKey: keys.card,
    thumbKey: keys.thumb,
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
