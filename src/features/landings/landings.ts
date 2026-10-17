import { and, count, desc, eq, inArray, like, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { z } from 'zod';
import { activityWrite, commitWrites, type ActivityActor } from '../activity/log';
import type { AppDb } from '../../lib/db/client';
import { releasePathQuery, slugRedirectQueries } from '../../lib/db/redirects';
import { landings, orders } from '../../lib/db/schema';
import { routes } from '../../lib/routes';
import { fieldErrors, type FieldErrors } from '../../lib/validation/errors';
import { SLUG_PATTERN } from '../posts/slug';
import {
  TRACKING_KEYS,
  cleanTracking,
  parseTrackingJson,
  serializeTracking,
  trackingErrors,
  type Tracking,
} from '../tracking/tracking';
import { parseBlocks, serializeBlocks, type LandingBlock } from './blocks';

const PAGE_SIZE = 20;

export const LANDING_STATUSES = ['draft', 'published'] as const;
export type LandingStatus = (typeof LANDING_STATUSES)[number];
export const LANDING_ROBOTS = ['noindex', 'index'] as const;
export type LandingRobots = (typeof LANDING_ROBOTS)[number];

export const LANDING_STATUS_LABELS: Record<LandingStatus, string> = {
  draft: 'Bản nháp',
  published: 'Đã xuất bản',
};

export type LandingInput = {
  title: string;
  slug: string;
  blocks: LandingBlock[];
  status: LandingStatus;
  robots: LandingRobots;
  seoTitle: string | null;
  metaDescription: string | null;
  ogMediaId: number | null;
  tracking: Tracking;
};

const landingFields = z.object({
  title: z.string().trim().min(1, 'Nhập tiêu đề.').max(180, 'Tiêu đề quá dài.'),
  slug: z
    .string()
    .trim()
    .min(1, 'Nhập slug.')
    .max(180, 'Slug quá dài.')
    .regex(SLUG_PATTERN, 'Slug chỉ gồm chữ thường, số và dấu gạch.'),
  blocksJson: z.string(),
  status: z.string(),
  robots: z.string(),
  seoTitle: z.string().trim().max(180, 'SEO title quá dài.'),
  metaDescription: z.string().trim().max(300, 'Mô tả SEO quá dài.'),
  ogMediaId: z.string(),
});

function formValue(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function optionalId(value: string): number | null {
  if (!value) return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function emptyToNull(value: string): string | null {
  return value ? value : null;
}

export function parseLandingForm(form: FormData): { ok: true; input: LandingInput } | { ok: false; errors: FieldErrors } {
  const parsed = landingFields.safeParse({
    title: formValue(form, 'title'),
    slug: formValue(form, 'slug'),
    blocksJson: formValue(form, 'blocksJson'),
    status: formValue(form, 'status'),
    robots: formValue(form, 'robots'),
    seoTitle: formValue(form, 'seoTitle'),
    metaDescription: formValue(form, 'metaDescription'),
    ogMediaId: formValue(form, 'ogMediaId'),
  });
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  const status: LandingStatus = parsed.data.status === 'published' ? 'published' : 'draft';
  const robots: LandingRobots = parsed.data.robots === 'index' ? 'index' : 'noindex';
  const ogMediaId = optionalId(parsed.data.ogMediaId);
  if (parsed.data.ogMediaId && ogMediaId === null) return { ok: false, errors: { ogMediaId: 'Ảnh chia sẻ không hợp lệ.' } };
  // Mã theo dõi riêng của trang: field dạng tracking_<key>. Validate chung với toàn site.
  const trackingInput = Object.fromEntries(
    TRACKING_KEYS.map((key) => [key, formValue(form, `tracking_${key}`)]),
  ) as Record<keyof Tracking, string>;
  const tErrors = trackingErrors(trackingInput);
  const firstTrackingError = Object.entries(tErrors)[0];
  if (firstTrackingError) return { ok: false, errors: { [`tracking_${firstTrackingError[0]}`]: firstTrackingError[1] } };
  const blocks = parseBlocks(parsed.data.blocksJson || '[]');
  if (status === 'published' && blocks.length === 0) {
    return { ok: false, errors: { blocksJson: 'Thêm ít nhất một khối trước khi xuất bản.' } };
  }
  return {
    ok: true,
    input: {
      title: parsed.data.title,
      slug: parsed.data.slug,
      blocks,
      status,
      robots,
      seoTitle: emptyToNull(parsed.data.seoTitle),
      metaDescription: emptyToNull(parsed.data.metaDescription),
      ogMediaId,
      tracking: cleanTracking(trackingInput),
    },
  };
}

export async function listLandings(db: AppDb, filters: { query: string; page: number }) {
  const term = filters.query.replace(/[%_]/g, '').trim().slice(0, 180);
  const where = term ? like(landings.title, `%${term}%`) : undefined;
  const page = Math.max(1, filters.page);
  const [totalRows, rows] = await Promise.all([
    db.select({ value: count() }).from(landings).where(where),
    db
      .select({
        id: landings.id,
        slug: landings.slug,
        title: landings.title,
        status: landings.status,
        robots: landings.robots,
        views: landings.views,
        updatedAt: landings.updatedAt,
      })
      .from(landings)
      .where(where)
      .orderBy(desc(landings.updatedAt), desc(landings.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
  ]);
  const total = totalRows[0]?.value ?? 0;
  // Đếm số đơn theo landing cho đúng các trang đang hiển thị (một truy vấn gộp, tránh N+1).
  const slugs = rows.map((row) => row.slug);
  const orderCounts = new Map<string, number>();
  if (slugs.length > 0) {
    const counts = await db
      .select({ slug: orders.landingSlug, value: count() })
      .from(orders)
      .where(inArray(orders.landingSlug, slugs))
      .groupBy(orders.landingSlug);
    for (const row of counts) if (row.slug) orderCounts.set(row.slug, row.value);
  }
  const withStats = rows.map((row) => {
    const ordersCount = orderCounts.get(row.slug) ?? 0;
    const conversion = row.views > 0 ? Math.round((ordersCount / row.views) * 1000) / 10 : null;
    return { ...row, orders: ordersCount, conversion };
  });
  return { rows: withStats, total, page, pageSize: PAGE_SIZE, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function getLanding(db: AppDb, id: number) {
  const rows = await db.select().from(landings).where(eq(landings.id, id)).limit(1);
  return rows[0] ?? null;
}

// Tăng bộ đếm lượt xem cho trang đã xuất bản. Một câu update nhẹ; không chặn lỗi đếm làm hỏng trang.
export async function bumpLandingView(db: AppDb, slug: string): Promise<void> {
  await db
    .update(landings)
    .set({ views: sql`${landings.views} + 1` })
    .where(and(eq(landings.slug, slug), eq(landings.status, 'published')));
}

// Xem thử trong CMS: lấy theo slug bất kể trạng thái. Chỉ dùng sau khi đã kiểm tra quyền admin ở trang.
export async function getLandingPreview(db: AppDb, slug: string) {
  const rows = await db
    .select({
      slug: landings.slug,
      title: landings.title,
      blocksJson: landings.blocksJson,
      robots: landings.robots,
      seoTitle: landings.seoTitle,
      metaDescription: landings.metaDescription,
      ogMediaId: landings.ogMediaId,
      trackingJson: landings.trackingJson,
    })
    .from(landings)
    .where(eq(landings.slug, slug))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { ...row, blocks: parseBlocks(row.blocksJson), tracking: parseTrackingJson(row.trackingJson) };
}

export async function getPublicLanding(db: AppDb, slug: string) {
  const rows = await db
    .select({
      id: landings.id,
      slug: landings.slug,
      title: landings.title,
      blocksJson: landings.blocksJson,
      robots: landings.robots,
      seoTitle: landings.seoTitle,
      metaDescription: landings.metaDescription,
      ogMediaId: landings.ogMediaId,
      trackingJson: landings.trackingJson,
      updatedAt: landings.updatedAt,
    })
    .from(landings)
    .where(and(eq(landings.slug, slug), eq(landings.status, 'published')))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { ...row, blocks: parseBlocks(row.blocksJson), tracking: parseTrackingJson(row.trackingJson) };
}

async function slugTaken(db: AppDb, slug: string, exceptId: number | null): Promise<boolean> {
  const rows = await db.select({ id: landings.id }).from(landings).where(eq(landings.slug, slug)).limit(1);
  return rows[0] ? rows[0].id !== exceptId : false;
}

export async function createLanding(
  db: AppDb,
  input: LandingInput,
  now = Date.now(),
  actor?: ActivityActor,
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  if (await slugTaken(db, input.slug, null)) return { ok: false, error: 'Slug đã được dùng.' };
  await db.insert(landings).values({
    slug: input.slug,
    title: input.title,
    blocksJson: serializeBlocks(input.blocks),
    status: input.status,
    robots: input.robots,
    seoTitle: input.seoTitle,
    metaDescription: input.metaDescription,
    ogMediaId: input.ogMediaId,
    trackingJson: serializeTracking(input.tracking),
    createdAt: now,
    updatedAt: now,
  });
  const inserted = await db.select({ id: landings.id }).from(landings).where(eq(landings.slug, input.slug)).limit(1);
  const id = inserted[0]?.id;
  if (!id) return { ok: false, error: 'Không lưu được trang đích.' };
  if (actor) {
    await commitWrites(db, [
      activityWrite(
        db,
        {
          actorId: actor.id,
          actorName: actor.name,
          action: 'landing.create',
          objectType: 'landing',
          objectId: String(id),
          summary: `Đã tạo trang đích “${input.title}”.`,
          createdAt: now,
        },
        false,
      ),
    ]);
  }
  return { ok: true, id };
}

export async function updateLanding(
  db: AppDb,
  id: number,
  input: LandingInput,
  now = Date.now(),
  actor?: ActivityActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const current = await getLanding(db, id);
  if (!current) return { ok: false, error: 'Không tìm thấy trang đích.' };
  if (await slugTaken(db, input.slug, id)) return { ok: false, error: 'Slug đã được dùng.' };
  const writes: BatchItem<'sqlite'>[] = [
    db
      .update(landings)
      .set({
        slug: input.slug,
        title: input.title,
        blocksJson: serializeBlocks(input.blocks),
        status: input.status,
        robots: input.robots,
        seoTitle: input.seoTitle,
        metaDescription: input.metaDescription,
        ogMediaId: input.ogMediaId,
        trackingJson: serializeTracking(input.tracking),
        updatedAt: now,
      })
      .where(eq(landings.id, id)),
  ];
  // URL công khai đổi khi trang đang/được xuất bản: giữ 301 từ slug cũ sang mới để không gãy quảng cáo đang chạy.
  const wasPublic = current.status === 'published';
  if (wasPublic && current.slug !== input.slug) {
    writes.push(...slugRedirectQueries(db, routes.landing(current.slug), routes.landing(input.slug), now));
  }
  if (input.status === 'published') {
    writes.push(releasePathQuery(db, routes.landing(input.slug)));
  }
  if (actor) {
    writes.push(
      activityWrite(
        db,
        {
          actorId: actor.id,
          actorName: actor.name,
          action: 'landing.update',
          objectType: 'landing',
          objectId: String(id),
          summary: `Đã cập nhật trang đích “${input.title}”.`,
          createdAt: now,
        },
        false,
      ),
    );
  }
  await commitWrites(db, writes);
  return { ok: true };
}

export async function deleteLanding(
  db: AppDb,
  id: number,
  now = Date.now(),
  actor?: ActivityActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const current = await getLanding(db, id);
  if (!current) return { ok: false, error: 'Không tìm thấy trang đích.' };
  const writes: BatchItem<'sqlite'>[] = [
    db.delete(landings).where(eq(landings.id, id)),
    // Dọn redirect từng trỏ tới/đi từ URL của trang để không còn đường dẫn mồ côi.
    releasePathQuery(db, routes.landing(current.slug)),
  ];
  if (actor) {
    writes.push(
      activityWrite(
        db,
        {
          actorId: actor.id,
          actorName: actor.name,
          action: 'landing.delete',
          objectType: 'landing',
          objectId: String(id),
          summary: `Đã xóa trang đích “${current.title}”.`,
          createdAt: now,
        },
        false,
      ),
    );
  }
  await commitWrites(db, writes);
  return { ok: true };
}
