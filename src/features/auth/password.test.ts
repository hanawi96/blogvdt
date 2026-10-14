import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

const SEEDED_HASH = 'pbkdf2-sha256$100000$bV4U+6I5zgQ0Z95uBC1llg==$JNy/7hDTmyXqaJERM88FsZm9O0a+7563KY8nRp5obh0=';

describe('mật khẩu', () => {
  it('khớp mật khẩu demo và từ chối mật khẩu sai', async () => {
    expect(await verifyPassword('DevLocal-VongDau-2026', SEEDED_HASH)).toBe(true);
    expect(await verifyPassword('sai-mat-khau', SEEDED_HASH)).toBe(false);
    expect(await verifyPassword('DevLocal-VongDau-2026', 'khong-dung-dinh-dang')).toBe(false);
  });

  it('hash mới xác minh lại được', async () => {
    const stored = await hashPassword('mat-khau-thu');
    expect(await verifyPassword('mat-khau-thu', stored)).toBe(true);
    expect(await verifyPassword('mat-khau-khac', stored)).toBe(false);
  });
});
