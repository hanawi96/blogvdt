export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_LOCK_MS = 15 * 60 * 1000;

export function isLoginLocked(lockedUntil: number | null, now: number): boolean {
  return lockedUntil !== null && lockedUntil > now;
}

export function nextLoginFailure(
  failCount: number,
  now: number,
): { failCount: number; lockedUntil: number | null } {
  const nextCount = failCount + 1;
  if (nextCount >= LOGIN_FAILURE_LIMIT) {
    return { failCount: nextCount, lockedUntil: now + LOGIN_LOCK_MS };
  }
  return { failCount: nextCount, lockedUntil: null };
}
