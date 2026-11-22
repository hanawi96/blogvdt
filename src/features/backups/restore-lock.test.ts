import { describe, expect, it } from 'vitest';
import { RESTORE_LOCK_TTL_MS, restoreLockIsActive } from './restore-lock';

describe('restoreLockIsActive', () => {
  it('false khi chưa có lock', () => {
    expect(restoreLockIsActive(null, 1_000_000)).toBe(false);
  });

  it('true trong TTL', () => {
    const started = 1_000_000;
    expect(restoreLockIsActive(started, started + 60_000)).toBe(true);
  });

  it('false khi quá TTL', () => {
    const started = 1_000_000;
    expect(restoreLockIsActive(started, started + RESTORE_LOCK_TTL_MS + 1)).toBe(false);
  });
});
