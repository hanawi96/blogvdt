import type { APIRoute } from 'astro';
import { activityActor } from '../../../../features/activity/log';
import { mutationError } from '../../../../features/auth/session';
import { setPostCategory } from '../../../../features/posts/posts';
import { createDb } from '../../../../lib/db/client';
import { getDbBinding } from '../../../../lib/cloudflare/env';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export const GET: APIRoute = () => new Response(null, { status: 405 });

export const POST: APIRoute = async ({ params, request, locals }) => {
  const session = locals.adminSession;
  if (!session) return reply(401, { error: 'Phiên đăng nhập đã hết hạn.' });
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) return reply(404, { error: 'Không tìm thấy bài viết.' });
  const form = await request.formData();
  const blocked = mutationError(request, session, form);
  if (blocked) return reply(403, { error: blocked });
  const raw = form.get('categoryId');
  const categoryId = raw === '' ? null : Number(raw);
  if (categoryId !== null && (!Number.isInteger(categoryId) || categoryId < 1)) return reply(422, { error: 'Danh mục không hợp lệ.' });
  const db = createDb(getDbBinding());
  const result = await setPostCategory(db, id, categoryId, await activityActor(db, session.userId));
  if (!result.ok) return reply(result.status, { error: result.error });
  return reply(200, { categoryName: result.categoryName });
};
