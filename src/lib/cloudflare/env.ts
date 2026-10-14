import { env } from 'cloudflare:workers';

export function getDbBinding(): D1Database {
  const database = env.DB;
  if (!database) {
    throw new Error('Thiếu binding D1 (DB). Kiểm tra wrangler.jsonc.');
  }
  return database;
}

export function getMediaBucket(): R2Bucket {
  const bucket = env.MEDIA;
  if (!bucket) {
    throw new Error('Thiếu binding R2 (MEDIA). Kiểm tra wrangler.jsonc.');
  }
  return bucket;
}
