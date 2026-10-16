export const ADMIN_ROLES = ['admin', 'editor'] as const;
export const ADMIN_STATUSES = ['active', 'invited', 'disabled'] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];
export type AdminStatus = (typeof ADMIN_STATUSES)[number];

export const ROLE_LABELS: Record<AdminRole, string> = {
  admin: 'Quản trị',
  editor: 'Biên tập',
};

export const STATUS_LABELS: Record<AdminStatus, string> = {
  active: 'Đang hoạt động',
  invited: 'Chưa đặt mật khẩu',
  disabled: 'Đã khóa',
};

const EDITOR_PREFIXES = ['/admin/posts', '/admin/categories', '/admin/tags', '/admin/media', '/admin/account'] as const;

export function isAdminRole(value: string): value is AdminRole {
  return value === 'admin' || value === 'editor';
}

export function isAdminStatus(value: string): value is AdminStatus {
  return value === 'active' || value === 'invited' || value === 'disabled';
}

export function canAccessPath(role: AdminRole, pathname: string): boolean {
  if (role === 'admin') return true;
  if (pathname === '/admin' || pathname === '/admin/logout') return true;
  return EDITOR_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function roleChangeError(input: {
  wasActiveAdmin: boolean;
  staysActiveAdmin: boolean;
  otherActiveAdmins: number;
}): string | null {
  if (input.wasActiveAdmin && !input.staysActiveAdmin && input.otherActiveAdmins < 1) {
    return 'Không hạ quyền hoặc khóa quản trị viên cuối cùng.';
  }
  return null;
}
