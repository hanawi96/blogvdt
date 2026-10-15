import type { APIRoute } from 'astro';
import { mutationError } from '../../../../features/auth/session';
import { deleteProducts, productAdminQuery, readProductListContext } from '../../../../features/products/products';
import { createDb } from '../../../../lib/db/client';
import { getDbBinding } from '../../../../lib/cloudflare/env';
import { routes } from '../../../../lib/routes';

export const GET: APIRoute = () => new Response(null, { status: 405 });

export const POST: APIRoute = async ({ params, request, locals, redirect }) => {
  const session = locals.adminSession;
  if (!session) return redirect(routes.adminLogin);
  const form = await request.formData();
  const list = readProductListContext(form);
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) return redirect(productAdminQuery(list));
  const error = mutationError(request, session, form);
  if (error) return new Response(error, { status: 403 });
  await deleteProducts(createDb(getDbBinding()), [id]);
  return redirect(productAdminQuery({ ...list, page: 1, notice: 'deleted' }), 303);
};
