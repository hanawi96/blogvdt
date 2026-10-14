import type { APIRoute } from 'astro';
import { destroySession, mutationError, SESSION_COOKIE } from '../../features/auth/session';
import { createDb } from '../../lib/db/client';
import { getDbBinding } from '../../lib/cloudflare/env';
import { routes } from '../../lib/routes';

export const GET: APIRoute = () => new Response(null, { status: 405 });

export const POST: APIRoute = async ({ request, locals, cookies, redirect }) => {
  const session = locals.adminSession;
  const form = await request.formData();
  if (!session) return new Response('Phiên không hợp lệ', { status: 403 });
  const error = mutationError(request, session, form);
  if (error) return new Response(error, { status: 403 });
  await destroySession(createDb(getDbBinding()), session.sessionId);
  cookies.delete(SESSION_COOKIE, { path: '/' });
  return redirect(routes.adminLogin, 303);
};
