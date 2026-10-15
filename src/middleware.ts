import { defineMiddleware } from 'astro:middleware';
import { canAccessPath } from './features/auth/access';
import { readSession, SESSION_COOKIE } from './features/auth/session';
import { createDb } from './lib/db/client';
import { getDbBinding } from './lib/cloudflare/env';
import { routes } from './lib/routes';

export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.adminSession = null;
  const { pathname } = context.url;
  if (!pathname.startsWith('/admin')) return next();

  const sessionId = context.cookies.get(SESSION_COOKIE)?.value;
  try {
    context.locals.adminSession = await readSession(createDb(getDbBinding()), sessionId);
  } catch (error) {
    console.error(JSON.stringify({ event: 'session_read_failed', name: error instanceof Error ? error.name : 'unknown' }));
  }

  const open = pathname === routes.adminLogin || pathname === routes.adminActivate;
  const session = context.locals.adminSession;
  if (!session && !open) return privateResponse(context.redirect(routes.adminLogin));
  if (session && !open && !canAccessPath(session.role, pathname)) {
    return privateResponse(
      new Response('Bạn không có quyền vào trang này.', {
        status: 403,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      }),
    );
  }

  return privateResponse(await next());
});

function privateResponse(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Robots-Tag', 'noindex');
  return response;
}
