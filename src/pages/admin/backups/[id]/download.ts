import type { APIRoute } from 'astro';
import { getBackupJob } from '../../../../features/backups/jobs';
import { createDb } from '../../../../lib/db/client';
import { getBackupBucket, getDbBinding } from '../../../../lib/cloudflare/env';
import { routes } from '../../../../lib/routes';

export const prerender = false;

export const GET: APIRoute = async ({ locals, params }) => {
  const session = locals.adminSession;
  if (!session) {
    return new Response(null, { status: 302, headers: { location: routes.adminLogin } });
  }
  if (session.role !== 'admin') {
    return new Response('Không có quyền.', { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) {
    return new Response('Không tìm thấy.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  const db = createDb(getDbBinding());
  const job = await getBackupJob(db, id);
  if (!job || job.status !== 'success' || !job.r2Key) {
    return new Response('Backup chưa sẵn sàng để tải.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  let bucket: R2Bucket;
  try {
    bucket = getBackupBucket();
  } catch {
    return new Response('Thiếu binding BACKUPS.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  const object = await bucket.get(job.r2Key);
  if (!object) {
    return new Response('Không tìm thấy file trên R2.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  const filename = `backup-${job.id}-${job.kind}.sql`;
  return new Response(object.body as unknown as BodyInit, {
    headers: {
      'content-type': 'application/sql; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'private, no-store',
    },
  });
};
