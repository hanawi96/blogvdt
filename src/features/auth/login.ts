import { eq } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { adminUsers, loginAttempts } from '../../lib/db/schema';
import { isLoginLocked, nextLoginFailure } from './lock';
import { hashPassword, verifyPassword } from './password';

export type LoginResult = { ok: true; userId: number } | { ok: false; reason: 'invalid' | 'locked' };

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

  const users = await db
    .select({ id: adminUsers.id, passwordHash: adminUsers.passwordHash })
    .from(adminUsers)
    .where(eq(adminUsers.username, username))
    .limit(1);
  const user = users[0];
  dummyHash ??= hashPassword('timing-pad-not-used-for-login');
  const passwordMatches = await verifyPassword(password, user?.passwordHash ?? (await dummyHash));
  if (!user || !passwordMatches) {
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

  if (current) await db.delete(loginAttempts).where(eq(loginAttempts.ipHash, ipHash));
  return { ok: true, userId: user.id };
}
