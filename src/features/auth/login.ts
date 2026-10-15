import { eq, or } from 'drizzle-orm';
import { activityWrite, actorLabel, commitWrites } from '../activity/log';
import type { AppDb } from '../../lib/db/client';
import { adminUsers, loginAttempts } from '../../lib/db/schema';
import { isAdminRole, type AdminRole } from './access';
import { isLoginLocked, nextLoginFailure } from './lock';
import { hashPassword, verifyPassword } from './password';

export type LoginResult =
  | { ok: true; userId: number; role: AdminRole }
  | { ok: false; reason: 'invalid' | 'locked' | 'disabled' };

let dummyHash: Promise<string> | null = null;

export async function attemptLogin(
  db: AppDb,
  username: string,
  password: string,
  ipHash: string,
  now = Date.now(),
): Promise<LoginResult> {
  const attempt = await db
    .select({
      failCount: loginAttempts.failCount,
      lockedUntil: loginAttempts.lockedUntil,
    })
    .from(loginAttempts)
    .where(eq(loginAttempts.ipHash, ipHash))
    .limit(1);
  const current = attempt[0];
  if (current && isLoginLocked(current.lockedUntil, now)) return { ok: false, reason: 'locked' };

  const identifier = username.trim();
  const users = await db
    .select({
      id: adminUsers.id,
      displayName: adminUsers.displayName,
      passwordHash: adminUsers.passwordHash,
      role: adminUsers.role,
      status: adminUsers.status,
    })
    .from(adminUsers)
    .where(or(eq(adminUsers.username, identifier), eq(adminUsers.email, identifier.toLowerCase())))
    .limit(1);
  const user = users[0];
  dummyHash ??= hashPassword('timing-pad-not-used-for-login');
  const passwordMatches = await verifyPassword(password, user?.passwordHash ?? (await dummyHash));
  if (!user || !passwordMatches || !isAdminRole(user.role)) {
    const failCount = current && current.lockedUntil !== null && current.lockedUntil <= now ? 0 : (current?.failCount ?? 0);
    const next = nextLoginFailure(failCount, now);
    await db
      .insert(loginAttempts)
      .values({ ipHash, failCount: next.failCount, lockedUntil: next.lockedUntil, updatedAt: now })
      .onConflictDoUpdate({
        target: loginAttempts.ipHash,
        set: { failCount: next.failCount, lockedUntil: next.lockedUntil, updatedAt: now },
      });
    return { ok: false, reason: next.lockedUntil ? 'locked' : 'invalid' };
  }

  if (user.status === 'disabled') return { ok: false, reason: 'disabled' };
  if (user.status !== 'active') return { ok: false, reason: 'invalid' };

  const actorName = actorLabel(user.displayName, user.id);
  await commitWrites(db, [
    ...(current ? [db.delete(loginAttempts).where(eq(loginAttempts.ipHash, ipHash))] : []),
    db.update(adminUsers).set({ lastLoginAt: now }).where(eq(adminUsers.id, user.id)),
    activityWrite(
      db,
      {
        actorId: user.id,
        actorName,
        action: 'auth.login',
        objectType: 'user',
        objectId: String(user.id),
        summary: 'Đã đăng nhập.',
        createdAt: now,
      },
      false,
    ),
  ]);
  return { ok: true, userId: user.id, role: user.role };
}
