import type { APIRoute } from 'astro';
import { mutationError } from '../../../../features/auth/session';
import { deletePost } from '../../../../features/posts/posts';
import { createDb } from '../../../../lib/db/client';
import { getDbBinding } from '../../../../lib/cloudflare/env';
import { routes } from '../../../../lib/routes';

export const GET: APIRoute = () => new Response(null, { status: 405 });

export const POST: APIRoute = async ({ params, request, locals, redirect }) => {
  const session = locals.adminSession;
  if (!session) return redirect(routes.adminLogin);
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) return redirect(routes.adminPosts);
  const form = await request.formData();
  const error = mutationError(request, session, form);
  if (error) return new Response(error, { status: 403 });
  await deletePost(createDb(getDbBinding()), id);
  return redirect(`${routes.adminPosts}?deleted=1`, 303);
};
