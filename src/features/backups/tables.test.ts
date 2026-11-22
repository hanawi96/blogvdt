import { describe, expect, it } from 'vitest';
import { sanitizeBackupTables, tablesForD1Export } from './tables';

describe('sanitizeBackupTables', () => {
  it('lọc whitelist và loại trùng', () => {
    expect(sanitizeBackupTables(['posts', 'posts', 'sessions', 'orders'])).toEqual(['posts', 'orders']);
  });

  it('trả null khi không còn bảng hợp lệ', () => {
    expect(sanitizeBackupTables([])).toBeNull();
    expect(sanitizeBackupTables(['sessions', 'd1_migrations'])).toBeNull();
    expect(sanitizeBackupTables('posts')).toBeNull();
  });
});

describe('tablesForD1Export', () => {
  it('full không lọc bảng', () => {
    expect(tablesForD1Export('full', null)).toBeNull();
    expect(tablesForD1Export('full', '["posts"]')).toBeNull();
  });

  it('partial trả whitelist đã sanitize', () => {
    expect(tablesForD1Export('partial', JSON.stringify(['orders', 'sessions', 'orders']))).toEqual(['orders']);
  });

  it('partial thiếu/hỏng tables thì lỗi (không export full)', () => {
    expect(() => tablesForD1Export('partial', null)).toThrow(/thiếu danh sách bảng/);
    expect(() => tablesForD1Export('partial', '{')).toThrow(/không hợp lệ/);
    expect(() => tablesForD1Export('partial', JSON.stringify(['sessions']))).toThrow(/không còn bảng hợp lệ/);
  });
});
