import { describe, expect, it } from 'vitest';
import { looksLikeSqlDump, validateBackupSqlFile } from './import-file';

describe('validateBackupSqlFile', () => {
  it('từ chối thiếu file / sai đuôi', () => {
    expect(validateBackupSqlFile(null).ok).toBe(false);
    expect(validateBackupSqlFile(new File(['x'], 'a.txt', { type: 'text/plain' })).ok).toBe(false);
  });

  it('chấp nhận .sql', () => {
    const ok = validateBackupSqlFile(new File(['-- dump'], 'backup.sql', { type: 'application/sql' }));
    expect(ok.ok).toBe(true);
  });
});

describe('looksLikeSqlDump', () => {
  it('nhận dump hợp lệ', async () => {
    expect(await looksLikeSqlDump(new TextEncoder().encode('-- D1 dump\nCREATE TABLE t(id);').buffer)).toBe(true);
    expect(await looksLikeSqlDump(new TextEncoder().encode('<html>').buffer)).toBe(false);
  });
});
