import { describe, expect, it } from 'vitest';
import { clampRetentionKeep, pickStaleBeyondRetention } from './jobs';
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

describe('retention keep', () => {
  it('clampRetentionKeep giới hạn 1–90, mặc định 14', () => {
    expect(clampRetentionKeep(7)).toBe(7);
    expect(clampRetentionKeep(90)).toBe(90);
    expect(clampRetentionKeep(0)).toBe(14);
    expect(clampRetentionKeep(91)).toBe(14);
    expect(clampRetentionKeep(1.5)).toBe(14);
  });

  it('pickStaleBeyondRetention giữ N mới nhất', () => {
    const jobs = [{ id: 5 }, { id: 4 }, { id: 3 }, { id: 2 }, { id: 1 }];
    expect(pickStaleBeyondRetention(jobs, 7)).toEqual([]);
    expect(pickStaleBeyondRetention(jobs, 3)).toEqual([{ id: 2 }, { id: 1 }]);
    expect(pickStaleBeyondRetention(jobs, 1)).toEqual([{ id: 4 }, { id: 3 }, { id: 2 }, { id: 1 }]);
  });
});
