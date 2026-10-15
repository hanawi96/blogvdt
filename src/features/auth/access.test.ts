import { describe, expect, it } from 'vitest';
import { canAccessPath, roleChangeError } from './access';
import { displayNameError, emailError } from './users';

describe('quyền CMS', () => {
  it('biên tập chỉ vào bài, danh mục, ảnh và tài khoản', () => {
    expect(canAccessPath('editor', '/admin')).toBe(true);
    expect(canAccessPath('editor', '/admin/posts')).toBe(true);
    expect(canAccessPath('editor', '/admin/posts/4')).toBe(true);
    expect(canAccessPath('editor', '/admin/posts/preview')).toBe(true);
    expect(canAccessPath('editor', '/admin/categories')).toBe(true);
    expect(canAccessPath('editor', '/admin/media/3/delete')).toBe(true);
    expect(canAccessPath('editor', '/admin/account')).toBe(true);
    expect(canAccessPath('editor', '/admin/users')).toBe(false);
    expect(canAccessPath('editor', '/admin/activity-logs')).toBe(false);
    expect(canAccessPath('editor', '/admin/settings')).toBe(false);
    expect(canAccessPath('editor', '/admin/seo')).toBe(false);
    expect(canAccessPath('editor', '/admin/products')).toBe(false);
    expect(canAccessPath('editor', '/admin/orders/14')).toBe(false);
  });

  it('quản trị vào được trang người dùng và cài đặt', () => {
    expect(canAccessPath('admin', '/admin/users/2')).toBe(true);
    expect(canAccessPath('admin', '/admin/settings')).toBe(true);
    expect(canAccessPath('admin', '/admin/seo')).toBe(true);
    expect(canAccessPath('admin', '/admin/activity-logs')).toBe(true);
  });

  it('không hạ hoặc khóa quản trị viên cuối cùng', () => {
    expect(roleChangeError({ wasActiveAdmin: true, staysActiveAdmin: false, otherActiveAdmins: 0 })).toMatch(/cuối cùng/);
    expect(roleChangeError({ wasActiveAdmin: true, staysActiveAdmin: false, otherActiveAdmins: 1 })).toBeNull();
    expect(roleChangeError({ wasActiveAdmin: true, staysActiveAdmin: true, otherActiveAdmins: 0 })).toBeNull();
    expect(roleChangeError({ wasActiveAdmin: false, staysActiveAdmin: false, otherActiveAdmins: 0 })).toBeNull();
  });

  it('email và họ tên phải hợp lệ', () => {
    expect(emailError('')).toMatch(/email/i);
    expect(emailError('khong-phai-email')).toMatch(/không hợp lệ/i);
    expect(emailError('a@b.co')).toBeNull();
    expect(displayNameError('   ')).toMatch(/họ tên/i);
    expect(displayNameError('An')).toBeNull();
  });
});
