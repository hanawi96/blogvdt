import type { APIRoute } from 'astro';
import { activityActor } from '../../../../features/activity/log';
import { mutationError } from '../../../../features/auth/session';
import { deleteLanding } from '../../../../features/landings/landings';
import { createDb } from '../../../../lib/db/client';
import { getDbBinding } from '../../../../lib/cloudflare/env';
import { routes } from '../../../../lib/routes';

export const GET: APIRoute = () => new Response(null, { status: 405 });

export const POST: APIRoute = async ({ params, request, locals, redirect }) => {
  const session = locals.adminSession;
  if (!session) return redirect(routes.adminLogin);
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) return redirect(routes.adminLandings);
  const form = await request.formData();
  const error = mutationError(request, session, form);
  if (error) return new Response(error, { status: 403 });
  const db = createDb(getDbBinding());
  const removed = await deleteLanding(db, id, Date.now(), await activityActor(db, session.userId));
  if (!removed.ok) return redirect(`${routes.adminLanding(id)}?error=${encodeURIComponent(removed.error)}`, 303);
  return redirect(`${routes.adminLandings}?deleted=1`, 303);
};
