import type { BatchItem } from 'drizzle-orm/batch';
import type { AppDb } from './client';

export function runBatch(db: AppDb, queries: BatchItem<'sqlite'>[]) {
  const [first, ...rest] = queries;
  if (!first) return Promise.resolve([]);
  return db.batch([first, ...rest]);
}
