import { defineMiddleware } from 'astro:middleware';
import { canAccessPath } from './features/auth/access';
import { readSession, SESSION_COOKIE } from './features/auth/session';
import { redirectHttpResponse } from './features/redirects/http';
import { resolvePublicRedirect } from './features/redirects/lookup';
import { normalizeInternalPath, skipsRedirectLookup } from './features/redirects/rules';
import { createDb } from './lib/db/client';
import { getDbBinding, requestAllowsIndexing } from './lib/cloudflare/env';
import { routes } from './lib/routes';

export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.adminSession = null;
  context.locals.allowIndex = requestAllowsIndexing(context.url.origin);
  const { pathname } = context.url;
  if (!pathname.startsWith('/admin')) {
    return finish(context, await withPublicRedirect(pathname, await next()));
  }

  const sessionId = context.cookies.get(SESSION_COOKIE)?.value;
  try {
    context.locals.adminSession = await readSession(createDb(getDbBinding()), sessionId);
  } catch (error) {
    console.error(JSON.stringify({ event: 'session_read_failed', name: error instanceof Error ? error.name : 'unknown' }));
  }

  const open = pathname === routes.adminLogin || pathname === routes.adminActivate;
  const session = context.locals.adminSession;
  if (!session && !open) return finish(context, privateResponse(context.redirect(routes.adminLogin)));
  if (session && !open && !canAccessPath(session.role, pathname)) {
    return finish(
      context,
      privateResponse(
        new Response('Bạn không có quyền vào trang này.', {
          status: 403,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        }),
      ),
    );
  }

  return finish(context, privateResponse(await next()));
});

async function withPublicRedirect(pathname: string, response: Response): Promise<Response> {
  if (response.status !== 404) return response;
  const path = normalizeInternalPath(pathname);
  if (!path || skipsRedirectLookup(path)) return response;
  try {
    const outcome = await resolvePublicRedirect(createDb(getDbBinding()), path);
    if (outcome) return redirectHttpResponse(outcome);
  } catch (error) {
    console.error(JSON.stringify({ event: 'redirect_lookup_failed', name: error instanceof Error ? error.name : 'unknown' }));
  }
  return response;
}

function finish(context: { locals: App.Locals; url: URL }, response: Response): Response {
  if (context.locals.allowIndex === false) response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}

function privateResponse(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}
