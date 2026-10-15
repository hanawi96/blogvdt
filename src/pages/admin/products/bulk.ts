import type { APIRoute } from 'astro';
import { mutationError } from '../../../features/auth/session';
import {
  deleteProducts,
  productAdminQuery,
  readProductBulk,
  readProductListContext,
  setProductsStatus,
} from '../../../features/products/products';
import { createDb } from '../../../lib/db/client';
import { getDbBinding } from '../../../lib/cloudflare/env';
import { routes } from '../../../lib/routes';

export const GET: APIRoute = () => new Response(null, { status: 405 });

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const session = locals.adminSession;
  if (!session) return redirect(routes.adminLogin);
  const form = await request.formData();
  const error = mutationError(request, session, form);
  if (error) return new Response(error, { status: 403 });
  const list = readProductListContext(form);
  const bulk = readProductBulk(form);
  if (!bulk) return redirect(productAdminQuery({ ...list, bulk: 'error' }), 303);
  const db = createDb(getDbBinding());
  try {
    const count =
      bulk.action === 'delete' ? await deleteProducts(db, bulk.ids) : await setProductsStatus(db, bulk.ids, bulk.action);
    const page = bulk.action === 'delete' ? 1 : list.page;
    return redirect(productAdminQuery({ ...list, page, bulk: { action: bulk.action, count } }), 303);
  } catch (failure) {
    console.error(JSON.stringify({ event: 'product_bulk_failed', action: bulk.action, name: failure instanceof Error ? failure.name : 'unknown' }));
    return redirect(productAdminQuery({ ...list, bulk: 'error' }), 303);
  }
};
