/**
 * Env-only `wrangler types` names R2Bucket/D1Database/Fetcher without defining them.
 * Pull those from the importable (@cloudflare/workers-types) surface — not full wrangler
 * runtime globals (HTMLRewriter Element/Text/Comment collide with DOM).
 */
import type {
  D1Database as WorkersD1Database,
  Fetcher as WorkersFetcher,
  ImagesBinding as WorkersImagesBinding,
  R2Bucket as WorkersR2Bucket,
} from '@cloudflare/workers-types';

declare global {
  type D1Database = WorkersD1Database;
  type R2Bucket = WorkersR2Bucket;
  type Fetcher = WorkersFetcher;
  type ImagesBinding = WorkersImagesBinding;
}

export {};
