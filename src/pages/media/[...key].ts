import type { APIRoute } from 'astro';
import { getMediaBucket } from '../../lib/cloudflare/env';

export const GET: APIRoute = async ({ params }) => {
  const key = Array.isArray(params.key) ? params.key.join('/') : params.key;
  if (!key || key.includes('..') || key.startsWith('/')) return new Response(null, { status: 404 });
  const object = await getMediaBucket().get(key);
  if (!object) return new Response(null, { status: 404 });
  const headers = new Headers();
  // Workers R2 typings vs DOM Headers/Body — bridge at this boundary only.
  object.writeHttpMetadata(headers as never);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  if (!headers.has('content-type')) headers.set('content-type', 'application/octet-stream');
  return new Response(object.body as unknown as BodyInit, { headers });
};
