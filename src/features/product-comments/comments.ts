import { and, asc, count, desc, eq, gte, sql } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { adminUsers, media, productComments, products } from '../../lib/db/schema';
import { routes } from '../../lib/routes';
import { detectImageType, imageSizeError, readRasterSize } from '../media/files';
import {
  COMMENT_ADMIN_PAGE_SIZE,
  COMMENT_RATE_LIMIT,
  COMMENT_RATE_WINDOW_MS,
  shopReplyAuthorName,
  type CommentStatus,
  validateGuestComment,
} from './parse';

export type PublicComment = {
  id: number;
  authorName: string;
  authorKind: 'guest' | 'shop';
  /** Avatar tài khoản admin (reply shop); guest luôn null. */
  avatarUrl: string | null;
  body: string;
  imageUrl: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  createdAt: number;
};

export type PublicCommentThread = PublicComment & { replies: PublicComment[] };

export type AdminComment = {
  id: number;
  productId: number;
  productName: string;
  productSlug: string;
  parentId: number | null;
  authorName: string;
  authorKind: 'guest' | 'shop';
  body: string;
  imageUrl: string | null;
  status: CommentStatus;
  createdAt: number;
};

function commentImageUrl(r2Key: string | null): string | null {
  return r2Key ? routes.media(r2Key) : null;
}

function toPublic(row: {
  id: number;
  authorName: string;
  authorKind: string;
  avatarR2Key: string | null;
  body: string;
  r2Key: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  createdAt: number;
}): PublicComment {
  const isShop = row.authorKind === 'shop';
  return {
    id: row.id,
    authorName: row.authorName,
    authorKind: isShop ? 'shop' : 'guest',
    avatarUrl: isShop && row.avatarR2Key ? routes.media(row.avatarR2Key) : null,
    body: row.body,
    imageUrl: commentImageUrl(row.r2Key),
    imageWidth: row.imageWidth,
    imageHeight: row.imageHeight,
    createdAt: row.createdAt,
  };
}

/** Comment gốc + reply đã duyệt, 1 cấp. */
export async function listPublicCommentThreads(db: AppDb, productId: number): Promise<PublicCommentThread[]> {
  const rows = await db
    .select({
      id: productComments.id,
      parentId: productComments.parentId,
      authorName: productComments.authorName,
      authorKind: productComments.authorKind,
      avatarR2Key: media.r2Key,
      body: productComments.body,
      r2Key: productComments.r2Key,
      imageWidth: productComments.imageWidth,
      imageHeight: productComments.imageHeight,
      createdAt: productComments.createdAt,
    })
    .from(productComments)
    .leftJoin(adminUsers, eq(productComments.adminUserId, adminUsers.id))
    .leftJoin(media, eq(adminUsers.avatarMediaId, media.id))
    .where(and(eq(productComments.productId, productId), eq(productComments.status, 'approved')))
    .orderBy(asc(productComments.id));

  const roots = new Map<number, PublicCommentThread>();
  for (const row of rows) {
    if (row.parentId == null) {
      roots.set(row.id, { ...toPublic(row), replies: [] });
    }
  }
  for (const row of rows) {
    if (row.parentId == null) continue;
    const parent = roots.get(row.parentId);
    if (parent) parent.replies.push(toPublic(row));
  }
  return [...roots.values()].reverse();
}

export async function countRecentByIp(db: AppDb, ipHash: string, now = Date.now()): Promise<number> {
  const since = now - COMMENT_RATE_WINDOW_MS;
  const rows = await db
    .select({ value: count() })
    .from(productComments)
    .where(and(eq(productComments.ipHash, ipHash), gte(productComments.createdAt, since)));
  return rows[0]?.value ?? 0;
}

async function resolveReplyParent(
  db: AppDb,
  productId: number,
  parentId: number | null,
): Promise<{ ok: true; parentId: number | null } | { ok: false; error: string }> {
  if (parentId == null) return { ok: true, parentId: null };
  if (!Number.isInteger(parentId) || parentId < 1) return { ok: false, error: 'Bình luận gốc không hợp lệ.' };
  const rows = await db
    .select({
      id: productComments.id,
      productId: productComments.productId,
      parentId: productComments.parentId,
      status: productComments.status,
    })
    .from(productComments)
    .where(eq(productComments.id, parentId))
    .limit(1);
  const parent = rows[0];
  if (!parent || parent.productId !== productId) return { ok: false, error: 'Không tìm thấy bình luận để trả lời.' };
  if (parent.parentId != null) return { ok: false, error: 'Chỉ trả lời được bình luận gốc.' };
  if (parent.status !== 'approved') return { ok: false, error: 'Bình luận này chưa hiển thị công khai.' };
  return { ok: true, parentId: parent.id };
}

export type CommentImage = {
  bytes: Uint8Array;
  r2Key: string;
  mimeType: string;
  width: number | null;
  height: number | null;
};

export async function parseCommentImage(file: File | null): Promise<
  { ok: true; image: CommentImage | null } | { ok: false; error: string }
> {
  if (!file || file.size <= 0) return { ok: true, image: null };
  const sizeError = imageSizeError(file.size);
  if (sizeError) return { ok: false, error: sizeError };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = detectImageType(bytes);
  if (!kind) return { ok: false, error: 'Chỉ nhận ảnh JPEG, PNG hoặc WebP.' };
  const size = readRasterSize(bytes);
  const id = crypto.randomUUID();
  const now = new Date();
  const folder = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return {
    ok: true,
    image: {
      bytes,
      r2Key: `comments/${folder}/${id}${kind.extension}`,
      mimeType: kind.mimeType,
      width: size?.width ?? null,
      height: size?.height ?? null,
    },
  };
}

export async function createGuestComment(
  db: AppDb,
  bucket: R2Bucket,
  input: {
    productId: number;
    parentId: number | null;
    authorName: string;
    body: string;
    ipHash: string;
    image: CommentImage | null;
  },
  now = Date.now(),
): Promise<{ ok: true; id: number } | { ok: false; error: string; status?: number }> {
  const fields = validateGuestComment(input);
  if (!fields.ok) return { ok: false, error: fields.error, status: 422 };

  const product = await db.select({ id: products.id }).from(products).where(eq(products.id, input.productId)).limit(1);
  if (!product[0]) return { ok: false, error: 'Sản phẩm không tồn tại.', status: 404 };

  const parent = await resolveReplyParent(db, input.productId, input.parentId);
  if (!parent.ok) return { ok: false, error: parent.error, status: 422 };

  const recent = await countRecentByIp(db, input.ipHash, now);
  if (recent >= COMMENT_RATE_LIMIT) {
    return { ok: false, error: 'Bạn gửi hơi nhiều. Thử lại sau khoảng 1 giờ.', status: 429 };
  }

  if (input.image) {
    await bucket.put(input.image.r2Key, input.image.bytes, {
      httpMetadata: { contentType: input.image.mimeType },
    });
  }

  try {
    const inserted = await db
      .insert(productComments)
      .values({
        productId: input.productId,
        parentId: parent.parentId,
        authorName: fields.authorName,
        authorKind: 'guest',
        body: fields.body,
        r2Key: input.image?.r2Key ?? null,
        imageWidth: input.image?.width ?? null,
        imageHeight: input.image?.height ?? null,
        status: 'pending',
        ipHash: input.ipHash,
        createdAt: now,
      })
      .returning({ id: productComments.id });
    const id = inserted[0]?.id;
    if (!id) throw new Error('missing comment id');
    return { ok: true, id };
  } catch (error) {
    if (input.image) await bucket.delete(input.image.r2Key).catch(() => undefined);
    console.error(JSON.stringify({ event: 'product_comment_create_failed', name: error instanceof Error ? error.name : 'unknown' }));
    return { ok: false, error: 'Không gửi được bình luận. Thử lại sau.', status: 500 };
  }
}

export async function createShopReply(
  db: AppDb,
  bucket: R2Bucket | null,
  input: {
    productId: number;
    parentId: number;
    adminUserId: number;
    authorName: string;
    body: string;
    image: CommentImage | null;
  },
  now = Date.now(),
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const body = input.body.replace(/\r\n/g, '\n').trim().slice(0, 1000);
  if (!body) return { ok: false, error: 'Nhập nội dung trả lời.' };
  if (!Number.isInteger(input.adminUserId) || input.adminUserId < 1) {
    return { ok: false, error: 'Phiên đăng nhập không hợp lệ.' };
  }
  const authorName = shopReplyAuthorName(input.authorName);

  const parent = await resolveReplyParent(db, input.productId, input.parentId);
  if (!parent.ok || parent.parentId == null) return { ok: false, error: parent.ok ? 'Thiếu bình luận gốc.' : parent.error };

  if (input.image) {
    if (!bucket) return { ok: false, error: 'Chưa cấu hình lưu ảnh.' };
    await bucket.put(input.image.r2Key, input.image.bytes, {
      httpMetadata: { contentType: input.image.mimeType },
    });
  }

  try {
    const inserted = await db
      .insert(productComments)
      .values({
        productId: input.productId,
        parentId: parent.parentId,
        authorName,
        authorKind: 'shop',
        adminUserId: input.adminUserId,
        body,
        r2Key: input.image?.r2Key ?? null,
        imageWidth: input.image?.width ?? null,
        imageHeight: input.image?.height ?? null,
        status: 'approved',
        ipHash: null,
        createdAt: now,
      })
      .returning({ id: productComments.id });
    const id = inserted[0]?.id;
    if (!id) throw new Error('missing comment id');
    return { ok: true, id };
  } catch (error) {
    if (input.image && bucket) await bucket.delete(input.image.r2Key).catch(() => undefined);
    console.error(JSON.stringify({ event: 'product_comment_shop_reply_failed', name: error instanceof Error ? error.name : 'unknown' }));
    return { ok: false, error: 'Không gửi được trả lời.' };
  }
}

export async function setCommentStatus(
  db: AppDb,
  id: number,
  status: Exclude<CommentStatus, 'pending'>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isInteger(id) || id < 1) return { ok: false, error: 'Bình luận không hợp lệ.' };
  const result = await db
    .update(productComments)
    .set({ status })
    .where(eq(productComments.id, id))
    .returning({ id: productComments.id });
  if (!result[0]) return { ok: false, error: 'Không tìm thấy bình luận.' };
  return { ok: true };
}

export async function deleteComment(
  db: AppDb,
  bucket: R2Bucket | null,
  id: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isInteger(id) || id < 1) return { ok: false, error: 'Bình luận không hợp lệ.' };

  const children = await db
    .select({ r2Key: productComments.r2Key })
    .from(productComments)
    .where(eq(productComments.parentId, id));
  const self = await db
    .select({ r2Key: productComments.r2Key })
    .from(productComments)
    .where(eq(productComments.id, id))
    .limit(1);
  if (!self[0]) return { ok: false, error: 'Không tìm thấy bình luận.' };

  await db.delete(productComments).where(eq(productComments.id, id));

  if (bucket) {
    const keys = [...children, ...self].map((row) => row.r2Key).filter((key): key is string => Boolean(key));
    await Promise.all(keys.map((key) => bucket.delete(key).catch(() => undefined)));
  }
  return { ok: true };
}

export async function listAdminComments(
  db: AppDb,
  input: { status: CommentStatus | 'all'; page: number },
): Promise<{ comments: AdminComment[]; total: number; page: number; pageCount: number; pendingCount: number }> {
  const page = Math.max(1, input.page);
  const offset = (page - 1) * COMMENT_ADMIN_PAGE_SIZE;
  const statusWhere = input.status === 'all' ? undefined : eq(productComments.status, input.status);

  const listQuery = db
    .select({
      id: productComments.id,
      productId: productComments.productId,
      productName: products.name,
      productSlug: products.slug,
      parentId: productComments.parentId,
      authorName: productComments.authorName,
      authorKind: productComments.authorKind,
      body: productComments.body,
      r2Key: productComments.r2Key,
      status: productComments.status,
      createdAt: productComments.createdAt,
    })
    .from(productComments)
    .innerJoin(products, eq(productComments.productId, products.id))
    .$dynamic();
  const filteredList = statusWhere ? listQuery.where(statusWhere) : listQuery;
  const countQuery = db.select({ value: count() }).from(productComments).$dynamic();
  const filteredCount = statusWhere ? countQuery.where(statusWhere) : countQuery;

  const [totalRows, pendingRows, rows] = await Promise.all([
    filteredCount,
    db.select({ value: count() }).from(productComments).where(eq(productComments.status, 'pending')),
    filteredList
      .orderBy(
        sql`CASE WHEN ${productComments.status} = 'pending' THEN 0 ELSE 1 END`,
        desc(productComments.createdAt),
        desc(productComments.id),
      )
      .limit(COMMENT_ADMIN_PAGE_SIZE)
      .offset(offset),
  ]);

  const total = totalRows[0]?.value ?? 0;
  return {
    comments: rows.map((row) => ({
      id: row.id,
      productId: row.productId,
      productName: row.productName,
      productSlug: row.productSlug,
      parentId: row.parentId,
      authorName: row.authorName,
      authorKind: row.authorKind === 'shop' ? 'shop' : 'guest',
      body: row.body,
      imageUrl: commentImageUrl(row.r2Key),
      status: row.status as CommentStatus,
      createdAt: row.createdAt,
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / COMMENT_ADMIN_PAGE_SIZE)),
    pendingCount: pendingRows[0]?.value ?? 0,
  };
}

/** Đảm bảo shop reply gắn đúng product của comment gốc. */
export async function resolveShopReplyTarget(
  db: AppDb,
  parentId: number,
): Promise<{ ok: true; productId: number; parentId: number; authorName: string } | { ok: false; error: string }> {
  const rows = await db
    .select({
      id: productComments.id,
      productId: productComments.productId,
      parentId: productComments.parentId,
      authorName: productComments.authorName,
      status: productComments.status,
    })
    .from(productComments)
    .where(eq(productComments.id, parentId))
    .limit(1);
  const row = rows[0];
  if (!row) return { ok: false, error: 'Không tìm thấy bình luận.' };
  if (row.parentId != null) return { ok: false, error: 'Chỉ trả lời được bình luận gốc.' };
  if (row.status !== 'approved') return { ok: false, error: 'Chỉ trả lời bình luận đã duyệt.' };
  return { ok: true, productId: row.productId, parentId: row.id, authorName: row.authorName };
}
