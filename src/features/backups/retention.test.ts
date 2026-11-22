import { describe, expect, it } from 'vitest';
import { canDeleteBackupJob } from './retention';

describe('canDeleteBackupJob', () => {
  it('cho phép xóa bản success/failed', () => {
    expect(canDeleteBackupJob({ status: 'success' })).toBe(true);
    expect(canDeleteBackupJob({ status: 'failed' })).toBe(true);
  });

  it('chặn xóa bản queued/running', () => {
    expect(canDeleteBackupJob({ status: 'queued' })).toBe(false);
    expect(canDeleteBackupJob({ status: 'running' })).toBe(false);
  });
});
