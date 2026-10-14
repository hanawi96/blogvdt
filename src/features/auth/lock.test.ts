import { describe, expect, it } from 'vitest';
import { isLoginLocked, LOGIN_LOCK_MS, nextLoginFailure } from './lock';

describe('giới hạn đăng nhập', () => {
  it('khóa từ lần sai thứ năm', () => {
    const now = 1_000;
    let count = 0;
    let lockedUntil: number | null = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const next = nextLoginFailure(count, now);
      count = next.failCount;
      lockedUntil = next.lockedUntil;
      expect(lockedUntil).toBeNull();
    }
    const locked = nextLoginFailure(count, now);
    expect(locked.failCount).toBe(5);
    expect(locked.lockedUntil).toBe(now + LOGIN_LOCK_MS);
    expect(isLoginLocked(locked.lockedUntil, now + 1)).toBe(true);
    expect(isLoginLocked(locked.lockedUntil, now + LOGIN_LOCK_MS)).toBe(false);
  });
});
