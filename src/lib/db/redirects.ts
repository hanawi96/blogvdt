import { and, eq, ne } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { isSafeRedirect } from '../http';
import type { AppDb } from './client';
import { redirects } from './schema';

export type StoredRedirect = { toPath: string; statusCode: number; enabled: number };

export async function listRedirectPaths(db: AppDb): Promise<string[]> {
  const rows = await db.select({ fromPath: redirects.fromPath }).from(redirects).where(eq(redirects.enabled, 1));
  return rows.map((row) => row.fromPath);
}

export async function findRedirect(db: AppDb, fromPath: string): Promise<StoredRedirect | null> {
  const rows = await db
    .select({ toPath: redirects.toPath, statusCode: redirects.statusCode, enabled: redirects.enabled })
    .from(redirects)
    .where(eq(redirects.fromPath, fromPath))
    .limit(1);
  return rows[0] ?? null;
}

export async function listRedirectEdges(db: AppDb) {
  return db
    .select({
      fromPath: redirects.fromPath,
      toPath: redirects.toPath,
      statusCode: redirects.statusCode,
      enabled: redirects.enabled,
    })
    .from(redirects);
}

// Cùng batch với lệnh đổi slug. Đường mới không còn là nguồn redirect.
// Các redirect đang trỏ vào đường cũ được trỏ thẳng tới đường mới.
export function slugRedirectQueries(db: AppDb, fromPath: string, toPath: string, now: number): BatchItem<'sqlite'>[] {
  if (fromPath === toPath || !isSafeRedirect(fromPath) || !isSafeRedirect(toPath)) return [];
  return redirectHopQueries(db, fromPath, toPath, 301, 1, now);
}

export function redirectHopQueries(
  db: AppDb,
  fromPath: string,
  toPath: string,
  statusCode: 301 | 302,
  enabled: number,
  now: number,
  exceptId?: number,
  previousFrom?: string,
): BatchItem<'sqlite'>[] {
  const clearDestination = exceptId
    ? db.delete(redirects).where(and(eq(redirects.fromPath, toPath), ne(redirects.id, exceptId)))
    : db.delete(redirects).where(eq(redirects.fromPath, toPath));
  const pointedHere = exceptId
    ? and(eq(redirects.toPath, fromPath), ne(redirects.id, exceptId))
    : eq(redirects.toPath, fromPath);
  const queries: BatchItem<'sqlite'>[] = [
    clearDestination,
    db.update(redirects).set({ toPath, updatedAt: now }).where(pointedHere),
  ];
  if (previousFrom && previousFrom !== fromPath) {
    const pointedBefore = exceptId
      ? and(eq(redirects.toPath, previousFrom), ne(redirects.id, exceptId))
      : eq(redirects.toPath, previousFrom);
    queries.push(db.update(redirects).set({ toPath, updatedAt: now }).where(pointedBefore));
  }
  queries.push(
    exceptId
      ? db
          .update(redirects)
          .set({ fromPath, toPath, statusCode, enabled, updatedAt: now })
          .where(eq(redirects.id, exceptId))
      : db
          .insert(redirects)
          .values({ fromPath, toPath, statusCode, enabled, createdAt: now, updatedAt: now })
          .onConflictDoUpdate({ target: redirects.fromPath, set: { toPath, statusCode, enabled, updatedAt: now } }),
  );
  return queries;
}

export function goneQueries(db: AppDb, path: string, now: number): BatchItem<'sqlite'>[] {
  return [
    db.update(redirects).set({ toPath: '', statusCode: 410, enabled: 1, updatedAt: now }).where(eq(redirects.toPath, path)),
    db
      .insert(redirects)
      .values({ fromPath: path, toPath: '', statusCode: 410, enabled: 1, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: redirects.fromPath, set: { toPath: '', statusCode: 410, enabled: 1, updatedAt: now } }),
  ];
}

export function dropPathQueries(db: AppDb, path: string): BatchItem<'sqlite'>[] {
  return [db.delete(redirects).where(eq(redirects.fromPath, path)), db.delete(redirects).where(eq(redirects.toPath, path))];
}

export function releasePathQuery(db: AppDb, path: string): BatchItem<'sqlite'> {
  return db.delete(redirects).where(eq(redirects.fromPath, path));
}
