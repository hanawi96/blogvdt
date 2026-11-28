import { formatVnDateInput } from './time';

/** Giới hạn file import SQL từ admin (DB hiện nhỏ; chừa dư). */
export const IMPORT_SQL_MAX_BYTES = 25 * 1024 * 1024;

export function validateBackupSqlFile(file: File | null): { ok: true; file: File } | { ok: false; error: string } {
  if (!file || !(file instanceof File) || file.size < 1) {
    return { ok: false, error: 'Chọn file backup .sql để khôi phục.' };
  }
  if (file.size > IMPORT_SQL_MAX_BYTES) {
    return { ok: false, error: 'File quá lớn (tối đa 25 MB).' };
  }
  const name = file.name.toLowerCase();
  if (!name.endsWith('.sql')) {
    return { ok: false, error: 'Chỉ nhận file .sql.' };
  }
  const type = (file.type || '').toLowerCase();
  if (
    type &&
    type !== 'application/sql' &&
    type !== 'application/x-sql' &&
    type !== 'text/plain' &&
    type !== 'text/sql' &&
    type !== 'application/octet-stream'
  ) {
    return { ok: false, error: 'Định dạng file không hợp lệ.' };
  }
  return { ok: true, file };
}

/** Kiểm tra nhanh nội dung dump (không thay cho xác thực schema đầy đủ). */
export async function looksLikeSqlDump(bytes: ArrayBuffer): Promise<boolean> {
  const sample = new TextDecoder().decode(bytes.byteLength > 4096 ? bytes.slice(0, 4096) : bytes);
  const text = sample.replace(/^\uFEFF/, '').trimStart().toUpperCase();
  if (!text) return false;
  return (
    text.startsWith('--') ||
    text.startsWith('/*') ||
    text.startsWith('PRAGMA') ||
    text.startsWith('BEGIN') ||
    text.startsWith('CREATE') ||
    text.startsWith('INSERT') ||
    text.startsWith('DROP') ||
    text.startsWith('ALTER')
  );
}

export function importObjectKey(): string {
  const id = crypto.randomUUID().replace(/-/g, '');
  const day = formatVnDateInput();
  return `backups/imports/${day}/${id}.sql`;
}
