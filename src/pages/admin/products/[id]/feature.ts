import type { APIRoute } from 'astro';
import { mutationError } from '../../../../features/auth/session';
import { productAdminQuery, readProductListContext, setProductFeatured } from '../../../../features/products/products';
import { createDb } from '../../../../lib/db/client';
import { getDbBinding } from '../../../../lib/cloudflare/env';
import { routes } from '../../../../lib/routes';

export const GET: APIRoute = () => new Response(null, { status: 405 });

export const POST: APIRoute = async ({ params, request, locals, redirect }) => {
  const session = locals.adminSession;
  if (!session) return redirect(routes.adminLogin);
  const id = Number(params.id);
  const form = await request.formData();
  const list = readProductListContext(form);
  if (!Number.isInteger(id) || id < 1) return redirect(productAdminQuery({ ...list, notice: 'feature-error' }));
  const error = mutationError(request, session, form);
  if (error) return new Response(error, { status: 403 });
  const result = await setProductFeatured(createDb(getDbBinding()), id, form.get('featured') === '1');
  if (!result.ok) return redirect(productAdminQuery({ ...list, notice: 'feature-error' }));
  return redirect(productAdminQuery({ ...list, notice: result.featured ? 'featured-on' : 'featured-off' }), 303);
};
