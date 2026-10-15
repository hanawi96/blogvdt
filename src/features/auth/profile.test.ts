import { describe, expect, it } from 'vitest';
import { describeUserChange, EMPTY_PROFILE, profileError, userInitials, type UserProfile } from './users';

const account = {
  displayName: 'Yên Nguyễn',
  email: 'yen@example.com',
  role: 'editor' as const,
  status: 'active' as const,
  ...EMPTY_PROFILE,
};

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return { ...EMPTY_PROFILE, ...overrides };
}

describe('hồ sơ tài khoản', () => {
  it('lấy chữ cái đầu và từ chối giới thiệu hoặc link sai', () => {
    expect(userInitials('Yên Nguyễn')).toBe('YN');
    expect(userInitials('Yên')).toBe('Y');
    expect(userInitials('   ')).toBe('?');
    expect(profileError(profile({ bio: 'a'.repeat(500) }))).toBeNull();
    expect(profileError(profile({ bio: 'a'.repeat(501) }))).toMatch(/quá dài/);
    expect(profileError(profile({ facebookUrl: 'javascript:alert(1)' }))).toMatch(/Facebook/);
    expect(profileError(profile({ websiteUrl: 'https://example.com/yen' }))).toBeNull();
    expect(profileError(profile())).toBeNull();
  });

  it('đổi giới thiệu thì ghi nhật ký, không chép nội dung giới thiệu', () => {
    expect(describeUserChange(account, account)).toBeNull();
    const change = describeUserChange(account, { ...account, bio: 'Làm vòng tại xưởng.' });
    expect(change?.action).toBe('user.update');
    expect(change?.summary).toBe('Đã cập nhật tài khoản Yên Nguyễn.');
    expect(change?.summary).not.toMatch(/xưởng/);
  });
});
