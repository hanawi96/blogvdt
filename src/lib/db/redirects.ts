import { eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { isSafeRedirect } from '../http';
import type { AppDb } from './client';
import { redirects } from './schema';

export async function findRedirect(db: AppDb, fromPath: string): Promise<string | null> {
  const rows = await db
    .select({ toPath: redirects.toPath })
    .from(redirects)
    .where(eq(redirects.fromPath, fromPath))
    .limit(1);
  return rows[0]?.toPath ?? null;
}

// Chạy cùng batch với lệnh đổi slug. Đường mới không còn là nguồn redirect,
// các redirect cũ trỏ thẳng tới đường mới để không tạo chuỗi chuyển hướng.
export function slugRedirectQueries(db: AppDb, fromPath: string, toPath: string, now: number): BatchItem<'sqlite'>[] {
  if (fromPath === toPath || !isSafeRedirect(fromPath) || !isSafeRedirect(toPath)) return [];
  return [
    db.delete(redirects).where(eq(redirects.fromPath, toPath)),
    db.update(redirects).set({ toPath }).where(eq(redirects.toPath, fromPath)),
    db
      .insert(redirects)
      .values({ fromPath, toPath, createdAt: now })
      .onConflictDoUpdate({ target: redirects.fromPath, set: { toPath } }),
  ];
}
