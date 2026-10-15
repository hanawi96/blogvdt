import { eq } from 'drizzle-orm';
import { adminUsers, media, sessions } from '../../lib/db/schema';
import type { AppDb } from '../../lib/db/client';
import { isSameOrigin } from '../../lib/http';
import { routes } from '../../lib/routes';
import { isAdminRole, type AdminRole } from './access';

export const SESSION_COOKIE = 'admin_session';
export const SESSION_MS = 8 * 60 * 60 * 1000;

export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_MS / 1000,
  };
}

export type AdminSession = {
  sessionId: string;
  userId: number;
  role: AdminRole;
  csrfToken: string;
  displayName: string;
  avatarUrl: string | null;
};

export async function createSession(db: AppDb, userId: number, role: AdminRole, now = Date.now()): Promise<AdminSession> {
  const sessionId = randomToken();
  const csrfToken = randomToken();
  await db.insert(sessions).values({
    id: sessionId,
    adminUserId: userId,
    csrfToken,
    expiresAt: now + SESSION_MS,
    createdAt: now,
  });
  const users = await db
    .select({ displayName: adminUsers.displayName, avatarKey: media.r2Key })
    .from(adminUsers)
    .leftJoin(media, eq(adminUsers.avatarMediaId, media.id))
    .where(eq(adminUsers.id, userId))
    .limit(1);
  const user = users[0];
  return {
    sessionId,
    userId,
    role,
    csrfToken,
    displayName: user?.displayName ?? '',
    avatarUrl: user?.avatarKey ? routes.media(user.avatarKey) : null,
  };
}

export async function readSession(db: AppDb, sessionId: string | undefined, now = Date.now()): Promise<AdminSession | null> {
  if (!sessionId) return null;
  const rows = await db
    .select({
      sessionId: sessions.id,
      userId: sessions.adminUserId,
      csrfToken: sessions.csrfToken,
      expiresAt: sessions.expiresAt,
      role: adminUsers.role,
      status: adminUsers.status,
      displayName: adminUsers.displayName,
      avatarKey: media.r2Key,
    })
    .from(sessions)
    .innerJoin(adminUsers, eq(adminUsers.id, sessions.adminUserId))
    .leftJoin(media, eq(adminUsers.avatarMediaId, media.id))
    .where(eq(sessions.id, sessionId))
    .limit(1);
  const row = rows[0];
  if (!row || row.expiresAt <= now || row.status !== 'active' || !isAdminRole(row.role)) {
    if (row) await db.delete(sessions).where(eq(sessions.id, sessionId));
    return null;
  }
  return {
    sessionId: row.sessionId,
    userId: row.userId,
    role: row.role,
    csrfToken: row.csrfToken,
    displayName: row.displayName,
    avatarUrl: row.avatarKey ? routes.media(row.avatarKey) : null,
  };
}

export async function destroySession(db: AppDb, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export function mutationError(request: Request, session: AdminSession, form: FormData): string | null {
  if (!isSameOrigin(request)) return 'Nguồn gửi không hợp lệ.';
  const csrf = form.get('csrf');
  if (typeof csrf !== 'string' || !csrfMatches(session.csrfToken, csrf)) return 'Phiên không hợp lệ. Tải lại trang.';
  return null;
}

export function csrfMatches(expected: string, received: string): boolean {
  const left = new TextEncoder().encode(expected);
  const right = new TextEncoder().encode(received);
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
