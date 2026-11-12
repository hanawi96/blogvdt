import type { APIRoute } from 'astro';
import { getMediaBucket } from '../../lib/cloudflare/env';

export const GET: APIRoute = async ({ params, request }) => {
  const key = Array.isArray(params.key) ? params.key.join('/') : params.key;
  if (!key || key.includes('..') || key.startsWith('/')) return new Response(null, { status: 404 });

  const head = await getMediaBucket().head(key);
  if (!head) return new Response(null, { status: 404 });

  // ETag theo R2: thay ảnh (ghi đè cùng key) sinh etag mới nên trình duyệt/CDN tải lại bản mới.
  const etag = `"${head.etag}"`;
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { etag, 'cache-control': cacheControl } });
  }

  const object = await getMediaBucket().get(key);
  if (!object) return new Response(null, { status: 404 });
  const headers = new Headers();
  // Workers R2 typings vs DOM Headers/Body — bridge at this boundary only.
  object.writeHttpMetadata(headers as never);
  // Giữ cache dài nhưng cho revalidate bằng ETag thay vì immutable, để ảnh thay thế hiện ngay.
  headers.set('cache-control', cacheControl);
  headers.set('etag', etag);
  if (!headers.has('content-type')) headers.set('content-type', 'application/octet-stream');
  return new Response(object.body as unknown as BodyInit, { headers });
};

const cacheControl = 'public, max-age=31536000, stale-while-revalidate=86400, must-revalidate';
