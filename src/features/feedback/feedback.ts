import { and, asc, count, desc, eq, isNotNull, max, sql } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { feedbackPhotos, media } from '../../lib/db/schema';
import { routes } from '../../lib/routes';
import { FEEDBACK_HOME_LIMIT, FEEDBACK_PAGE_SIZE, FEEDBACK_PIN_MAX } from './query';

export { FEEDBACK_PIN_MAX };

export type FeedbackPhoto = {
  id: number;
  src: string;
  alt: string;
  width: number;
  height: number;
  pinRank: number | null;
};

export type FeedbackPageResult = {
  photos: FeedbackPhoto[];
  page: number;
  pageCount: number;
  total: number;
};

const published = eq(feedbackPhotos.status, 'published');
/** Ghim trước (1→9), rồi ảnh thường theo id mới hơn. */
const publicOrder = [
  sql`CASE WHEN ${feedbackPhotos.pinRank} IS NULL THEN 1 ELSE 0 END`,
  asc(feedbackPhotos.pinRank),
  desc(feedbackPhotos.id),
] as const;

const photoSelect = {
  id: feedbackPhotos.id,
  publicPath: feedbackPhotos.publicPath,
  altText: feedbackPhotos.altText,
  width: feedbackPhotos.width,
  height: feedbackPhotos.height,
  pinRank: feedbackPhotos.pinRank,
  r2Key: media.r2Key,
  mediaWidth: media.width,
  mediaHeight: media.height,
  mediaAlt: media.altText,
};

export async function listPublicFeedback(
  db: AppDb,
  page = 1,
  pageSize = FEEDBACK_PAGE_SIZE,
): Promise<FeedbackPageResult> {
  const safeSize = Math.min(48, Math.max(1, Math.floor(pageSize) || FEEDBACK_PAGE_SIZE));
  const totalRows = await db.select({ value: count() }).from(feedbackPhotos).where(published);
  const total = totalRows[0]?.value ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / safeSize));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  if (total === 0) return { photos: [], page: 1, pageCount: 1, total: 0 };

  const rows = await db
    .select(photoSelect)
    .from(feedbackPhotos)
    .leftJoin(media, eq(feedbackPhotos.mediaId, media.id))
    .where(published)
    .orderBy(...publicOrder)
    .limit(safeSize)
    .offset((current - 1) * safeSize);

  return { photos: rows.map(mapPhoto), page: current, pageCount, total };
}

/** Rail trang chủ: ưu tiên ảnh ghim rồi ảnh mới. */
export async function listHomeFeedback(db: AppDb, limit = FEEDBACK_HOME_LIMIT): Promise<FeedbackPhoto[]> {
  const safeLimit = Math.min(24, Math.max(1, Math.floor(limit) || FEEDBACK_HOME_LIMIT));
  const rows = await db
    .select(photoSelect)
    .from(feedbackPhotos)
    .leftJoin(media, eq(feedbackPhotos.mediaId, media.id))
    .where(published)
    .orderBy(...publicOrder)
    .limit(safeLimit);
  return rows.map(mapPhoto);
}

export async function listAdminFeedback(
  db: AppDb,
  page = 1,
  pageSize = FEEDBACK_PAGE_SIZE,
): Promise<FeedbackPageResult & { photos: Array<FeedbackPhoto & { mediaId: number | null }>; pinnedCount: number }> {
  const safeSize = Math.min(48, Math.max(1, Math.floor(pageSize) || FEEDBACK_PAGE_SIZE));
  const [totalRows, pinnedRows] = await Promise.all([
    db.select({ value: count() }).from(feedbackPhotos),
    db.select({ value: count() }).from(feedbackPhotos).where(isNotNull(feedbackPhotos.pinRank)),
  ]);
  const total = totalRows[0]?.value ?? 0;
  const pinnedCount = pinnedRows[0]?.value ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / safeSize));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const rows = await db
    .select({
      ...photoSelect,
      mediaId: feedbackPhotos.mediaId,
    })
    .from(feedbackPhotos)
    .leftJoin(media, eq(feedbackPhotos.mediaId, media.id))
    .orderBy(...publicOrder)
    .limit(safeSize)
    .offset((current - 1) * safeSize);

  return {
    photos: rows.map((row) => ({ ...mapPhoto(row), mediaId: row.mediaId })),
    page: current,
    pageCount,
    total,
    pinnedCount,
  };
}

export async function attachFeedbackMedia(
  db: AppDb,
  input: { mediaId: number; altText?: string; width?: number | null; height?: number | null; now?: number },
): Promise<{ ok: true; photo: FeedbackPhoto & { mediaId: number } } | { ok: false; error: string }> {
  const mediaId = input.mediaId;
  if (!Number.isInteger(mediaId) || mediaId < 1) return { ok: false, error: 'Ảnh không hợp lệ.' };

  const existing = await db
    .select({ id: feedbackPhotos.id })
    .from(feedbackPhotos)
    .where(eq(feedbackPhotos.mediaId, mediaId))
    .limit(1);
  if (existing[0]) return { ok: false, error: 'Ảnh này đã có trong feedback.' };

  const mediaRow = await db
    .select({
      id: media.id,
      r2Key: media.r2Key,
      altText: media.altText,
      width: media.width,
      height: media.height,
    })
    .from(media)
    .where(eq(media.id, mediaId))
    .limit(1);
  if (!mediaRow[0]) return { ok: false, error: 'Không tìm thấy ảnh trong thư viện.' };

  const peak = await db.select({ value: max(feedbackPhotos.sortOrder) }).from(feedbackPhotos);
  const sortOrder = (peak[0]?.value ?? 0) + 10;
  const now = input.now ?? Date.now();
  const altText = (input.altText ?? mediaRow[0].altText ?? '').trim() || 'Ảnh phản hồi mua hàng từ khách';
  const width = input.width ?? mediaRow[0].width;
  const height = input.height ?? mediaRow[0].height;
  const inserted = await db
    .insert(feedbackPhotos)
    .values({
      mediaId,
      publicPath: null,
      altText,
      width,
      height,
      sortOrder,
      pinRank: null,
      status: 'published',
      createdAt: now,
    })
    .returning({ id: feedbackPhotos.id });

  const id = inserted[0]?.id;
  if (!id) return { ok: false, error: 'Không lưu được feedback.' };
  return {
    ok: true,
    photo: {
      id,
      mediaId,
      src: routes.media(mediaRow[0].r2Key),
      alt: altText,
      width: width ?? 600,
      height: height ?? 752,
      pinRank: null,
    },
  };
}

export async function pinFeedbackPhoto(
  db: AppDb,
  id: number,
): Promise<{ ok: true; pinRank: number; pinnedCount: number } | { ok: false; error: string }> {
  if (!Number.isInteger(id) || id < 1) return { ok: false, error: 'Ảnh không hợp lệ.' };

  const row = await db
    .select({ id: feedbackPhotos.id, pinRank: feedbackPhotos.pinRank })
    .from(feedbackPhotos)
    .where(eq(feedbackPhotos.id, id))
    .limit(1);
  if (!row[0]) return { ok: false, error: 'Không tìm thấy ảnh feedback.' };
  if (row[0].pinRank != null) {
    const pinnedCount = await countPinned(db);
    return { ok: true, pinRank: row[0].pinRank, pinnedCount };
  }

  const used = await db
    .select({ pinRank: feedbackPhotos.pinRank })
    .from(feedbackPhotos)
    .where(isNotNull(feedbackPhotos.pinRank));
  if (used.length >= FEEDBACK_PIN_MAX) {
    return { ok: false, error: `Đã ghim tối đa ${FEEDBACK_PIN_MAX} ảnh.` };
  }
  const taken = new Set(used.map((item) => item.pinRank));
  let pinRank = 0;
  for (let rank = 1; rank <= FEEDBACK_PIN_MAX; rank += 1) {
    if (!taken.has(rank)) {
      pinRank = rank;
      break;
    }
  }
  if (pinRank < 1) return { ok: false, error: `Đã ghim tối đa ${FEEDBACK_PIN_MAX} ảnh.` };

  await db.update(feedbackPhotos).set({ pinRank }).where(eq(feedbackPhotos.id, id));
  return { ok: true, pinRank, pinnedCount: used.length + 1 };
}

export async function unpinFeedbackPhoto(
  db: AppDb,
  id: number,
): Promise<{ ok: true; pinnedCount: number } | { ok: false; error: string }> {
  if (!Number.isInteger(id) || id < 1) return { ok: false, error: 'Ảnh không hợp lệ.' };

  const row = await db
    .select({ id: feedbackPhotos.id, pinRank: feedbackPhotos.pinRank })
    .from(feedbackPhotos)
    .where(eq(feedbackPhotos.id, id))
    .limit(1);
  if (!row[0]) return { ok: false, error: 'Không tìm thấy ảnh feedback.' };
  if (row[0].pinRank == null) {
    return { ok: true, pinnedCount: await countPinned(db) };
  }

  await db.update(feedbackPhotos).set({ pinRank: null }).where(eq(feedbackPhotos.id, id));
  return { ok: true, pinnedCount: await countPinned(db) };
}

export type FeedbackPinMove = 'up' | 'down';

/** Đổi chỗ với ảnh ghim liền kề (theo thứ tự pin_rank). */
export async function reorderPinnedFeedback(
  db: AppDb,
  id: number,
  direction: FeedbackPinMove,
): Promise<
  | { ok: true; updates: Array<{ id: number; pinRank: number }> }
  | { ok: false; error: string }
> {
  if (!Number.isInteger(id) || id < 1) return { ok: false, error: 'Ảnh không hợp lệ.' };
  if (direction !== 'up' && direction !== 'down') return { ok: false, error: 'Hướng di chuyển không hợp lệ.' };

  const pinned = await db
    .select({ id: feedbackPhotos.id, pinRank: feedbackPhotos.pinRank })
    .from(feedbackPhotos)
    .where(isNotNull(feedbackPhotos.pinRank))
    .orderBy(asc(feedbackPhotos.pinRank), desc(feedbackPhotos.id));

  const index = pinned.findIndex((item) => item.id === id);
  if (index < 0) return { ok: false, error: 'Chỉ di chuyển được ảnh đang ghim.' };
  const swapIndex = direction === 'up' ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= pinned.length) {
    return { ok: false, error: direction === 'up' ? 'Ảnh đã ở vị trí đầu.' : 'Ảnh đã ở vị trí cuối.' };
  }

  const current = pinned[index]!;
  const neighbor = pinned[swapIndex]!;
  const currentRank = current.pinRank;
  const neighborRank = neighbor.pinRank;
  if (currentRank == null || neighborRank == null) return { ok: false, error: 'Không đổi được vị trí.' };

  // UNIQUE pin_rank: tạm null một bên rồi gán lại.
  await db.update(feedbackPhotos).set({ pinRank: null }).where(eq(feedbackPhotos.id, current.id));
  await db.update(feedbackPhotos).set({ pinRank: currentRank }).where(eq(feedbackPhotos.id, neighbor.id));
  await db.update(feedbackPhotos).set({ pinRank: neighborRank }).where(eq(feedbackPhotos.id, current.id));

  return {
    ok: true,
    updates: [
      { id: current.id, pinRank: neighborRank },
      { id: neighbor.id, pinRank: currentRank },
    ],
  };
}

export async function deleteFeedbackPhoto(db: AppDb, id: number): Promise<void> {
  if (!Number.isInteger(id) || id < 1) return;
  await db.delete(feedbackPhotos).where(eq(feedbackPhotos.id, id));
}

export async function listFeedbackMediaIds(db: AppDb): Promise<number[]> {
  const rows = await db
    .select({ id: feedbackPhotos.mediaId })
    .from(feedbackPhotos)
    .where(and(eq(feedbackPhotos.status, 'published')));
  return rows.flatMap((row) => (row.id != null ? [row.id] : []));
}

export async function countPinned(db: AppDb): Promise<number> {
  const rows = await db.select({ value: count() }).from(feedbackPhotos).where(isNotNull(feedbackPhotos.pinRank));
  return rows[0]?.value ?? 0;
}

function mapPhoto(row: {
  id: number;
  publicPath: string | null;
  altText: string;
  width: number | null;
  height: number | null;
  pinRank: number | null;
  r2Key: string | null;
  mediaWidth: number | null;
  mediaHeight: number | null;
  mediaAlt: string | null;
}): FeedbackPhoto {
  const src = row.publicPath || (row.r2Key ? routes.media(row.r2Key) : '');
  return {
    id: row.id,
    src,
    alt: row.altText || row.mediaAlt || 'Ảnh phản hồi mua hàng từ khách',
    width: row.width ?? row.mediaWidth ?? 600,
    height: row.height ?? row.mediaHeight ?? 752,
    pinRank: row.pinRank,
  };
}
