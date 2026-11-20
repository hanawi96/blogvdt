import type { APIRoute } from 'astro';
import { createGuestComment, parseCommentImage } from '../../features/product-comments/comments';
import { createDb } from '../../lib/db/client';
import { getDbBinding, getMediaBucket } from '../../lib/cloudflare/env';
import { clientIp, hashIp, isSameOrigin } from '../../lib/http';

export const prerender = false;

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!isSameOrigin(request)) {
    return json({ ok: false, error: 'Yêu cầu không hợp lệ.' }, 403);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: 'Dữ liệu gửi không hợp lệ.' }, 400);
  }

  const productId = Number(form.get('productId'));
  if (!Number.isInteger(productId) || productId < 1) {
    return json({ ok: false, error: 'Sản phẩm không hợp lệ.' }, 422);
  }

  const parentRaw = String(form.get('parentId') ?? '').trim();
  const parentId = parentRaw === '' ? null : Number(parentRaw);
  if (parentId != null && (!Number.isInteger(parentId) || parentId < 1)) {
    return json({ ok: false, error: 'Bình luận gốc không hợp lệ.' }, 422);
  }

  const imageField = form.get('image');
  const imageFile = imageField instanceof File && imageField.size > 0 ? imageField : null;
  const parsedImage = await parseCommentImage(imageFile);
  if (!parsedImage.ok) return json({ ok: false, error: parsedImage.error }, 422);

  let address: string | null = null;
  try {
    address = clientAddress;
  } catch {
    address = null;
  }
  const ipHash = await hashIp(clientIp(request, address));

  try {
    const result = await createGuestComment(createDb(getDbBinding()), getMediaBucket(), {
      productId,
      parentId,
      authorName: String(form.get('authorName') ?? ''),
      body: String(form.get('body') ?? ''),
      ipHash,
      image: parsedImage.image,
    });
    if (!result.ok) return json({ ok: false, error: result.error }, result.status ?? 422);
    return json({ ok: true, id: result.id }, 201);
  } catch (error) {
    console.error(JSON.stringify({ event: 'product_comments_api_failed', name: error instanceof Error ? error.name : 'unknown' }));
    return json({ ok: false, error: 'Không gửi được bình luận. Thử lại sau.' }, 500);
  }
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
    },
  });
}
