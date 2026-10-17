import type { APIRoute } from 'astro';
import { activityActor } from '../../../features/activity/log';
import { mutationError } from '../../../features/auth/session';
import {
  bulkPublishPosts,
  bulkPurgePosts,
  bulkRestorePosts,
  bulkTrashPosts,
  readPostBulk,
  type BulkResult,
} from '../../../features/posts/posts';
import { readRetirement } from '../../../features/redirects/rules';
import { createDb } from '../../../lib/db/client';
import { getDbBinding } from '../../../lib/cloudflare/env';
import { routes } from '../../../lib/routes';

type ListContext = { q: string; status: string; sort: string; page: number };

function readListContext(form: FormData): ListContext {
  const read = (name: string) => {
    const value = form.get(name);
    return typeof value === 'string' ? value : '';
  };
  const pageRaw = Number(read('page'));
  return {
    q: read('q').slice(0, 180),
    status: read('status'),
    sort: read('sort'),
    page: Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1,
  };
}

function listUrl(list: ListContext, extra: Record<string, string>): string {
  const params = new URLSearchParams();
  if (list.q) params.set('q', list.q);
  if (list.status === 'trash' || list.status === 'published' || list.status === 'draft') params.set('status', list.status);
  if (list.sort === 'oldest') params.set('sort', 'oldest');
  if (list.page > 1) params.set('page', String(list.page));
  for (const [key, value] of Object.entries(extra)) if (value !== '') params.set(key, value);
  const text = params.toString();
  return text ? `${routes.adminPosts}?${text}` : routes.adminPosts;
}

function done(list: ListContext, action: string, result: BulkResult): string {
  // Xóa hàng loạt rút gọn danh sách nên quay về trang đầu để tránh trang trống.
  const page = action === 'trash' || action === 'purge' ? 1 : list.page;
  return listUrl({ ...list, page }, { bulk: action, n: String(result.count), skip: String(result.skipped) });
}

export const GET: APIRoute = () => new Response(null, { status: 405 });

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const session = locals.adminSession;
  if (!session) return redirect(routes.adminLogin);
  const form = await request.formData();
  const denied = mutationError(request, session, form);
  if (denied) return new Response(denied, { status: 403 });

  const list = readListContext(form);
  const bulk = readPostBulk(form);
  if (!bulk) return redirect(listUrl(list, { error: 'bulk' }), 303);

  const db = createDb(getDbBinding());
  const actor = await activityActor(db, session.userId);
  try {
    if (bulk.action === 'publish') {
      return redirect(done(list, 'publish', await bulkPublishPosts(db, bulk.ids, actor)), 303);
    }
    if (bulk.action === 'trash') {
      const trashed = await bulkTrashPosts(db, bulk.ids, readRetirement(form), actor);
      if (!trashed.ok) return redirect(listUrl(list, { error: 'retire' }), 303);
      return redirect(done(list, 'trash', trashed.result), 303);
    }
    if (bulk.action === 'restore') {
      return redirect(done(list, 'restore', await bulkRestorePosts(db, bulk.ids, actor)), 303);
    }
    const purged = await bulkPurgePosts(db, bulk.ids, session.role, actor);
    if (!purged.ok) return redirect(listUrl(list, { error: 'bulk' }), 303);
    return redirect(done(list, 'purge', purged.result), 303);
  } catch (failure) {
    console.error(JSON.stringify({ event: 'post_bulk_failed', action: bulk.action, name: failure instanceof Error ? failure.name : 'unknown' }));
    return redirect(listUrl(list, { error: 'bulk' }), 303);
  }
};
