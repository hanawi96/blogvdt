import { describe, expect, it } from 'vitest';
import { GROUP_NAME_MAX, groupInUseError, normalizeGroupName, parseGroupName } from './groups';

describe('tên nhóm nguyên liệu', () => {
  it('gộp khoảng trắng thừa', () => {
    expect(normalizeGroupName('  Charm   bạc ')).toBe('Charm bạc');
    expect(parseGroupName('  Đá  -  Hổ phách ')).toEqual({ ok: true, name: 'Đá - Hổ phách' });
  });

  it('từ chối tên rỗng hoặc quá dài', () => {
    expect(parseGroupName('   ')).toEqual({ ok: false, error: 'Nhập tên nhóm.' });
    expect(parseGroupName('x'.repeat(GROUP_NAME_MAX + 1))).toEqual({ ok: false, error: 'Tên nhóm quá dài.' });
    expect(parseGroupName('x'.repeat(GROUP_NAME_MAX)).ok).toBe(true);
  });

  it('chỉ chặn xóa khi nhóm còn nguyên liệu', () => {
    expect(groupInUseError(0)).toBeNull();
    expect(groupInUseError(4)).toContain('4 nguyên liệu');
  });
});
