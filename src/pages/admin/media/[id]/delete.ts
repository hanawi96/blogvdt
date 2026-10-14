import type { APIRoute } from 'astro';
import { mutationError } from '../../../../features/auth/session';
import { deleteMedia } from '../../../../features/media/media';
import { createDb } from '../../../../lib/db/client';
import { getDbBinding, getMediaBucket } from '../../../../lib/cloudflare/env';
import { routes } from '../../../../lib/routes';

export const GET: APIRoute = () => new Response(null, { status: 405 });

export const POST: APIRoute = async ({ params, request, locals, redirect }) => {
  const session = locals.adminSession;
  if (!session) return redirect(routes.adminLogin);
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) return redirect(`${routes.adminMedia}?error=missing`);
  const wantsJson = request.headers.get('accept')?.includes('application/json') ?? false;
  const form = await request.formData();
  const error = mutationError(request, session, form);
  if (error) {
    if (wantsJson) return json({ ok: false, error }, 403);
    return new Response(error, { status: 403 });
  }
  const result = await deleteMedia(createDb(getDbBinding()), getMediaBucket(), id);
  if (!result.ok) {
    if (wantsJson) return json({ ok: false, error: result.error }, 422);
    const code = result.error.includes('Không tìm thấy') ? 'missing' : 'in-use';
    return redirect(`${routes.adminMedia}?error=${code}`);
  }
  if (wantsJson) return json({ ok: true });
  return redirect(routes.adminMedia, 303);
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
