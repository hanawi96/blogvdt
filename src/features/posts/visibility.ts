import { and, eq, isNull, type SQL } from 'drizzle-orm';
import { posts } from '../../lib/db/schema';

export function notTrashed(): SQL {
  return isNull(posts.deletedAt);
}

export function livePublished(): SQL {
  const where = and(eq(posts.status, 'published'), isNull(posts.deletedAt));
  if (!where) throw new Error('Điều kiện bài xuất bản không hợp lệ.');
  return where;
}
