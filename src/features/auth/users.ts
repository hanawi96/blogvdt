import { and, count, desc, eq, like, ne, or, sql } from 'drizzle-orm';
import { activityText, activityWrite, actorLabel, commitWrites, type ActivityActor } from '../activity/log';
import type { AppDb } from '../../lib/db/client';
import { adminUsers, media, passwordResets, sessions } from '../../lib/db/schema';
import { isHttpUrl } from '../../lib/http';
import { routes } from '../../lib/routes';
import {
  isAdminRole,
  isAdminStatus,
  ROLE_LABELS,
  roleChangeError,
  type AdminRole,
  type AdminStatus,
} from './access';
import { hashPassword, passwordError, verifyPassword } from './password';
import { hashToken, randomToken } from './session';

export const USER_PAGE_SIZE = 20;
export const RESET_MS = 24 * 60 * 60 * 1000;
export const BIO_MAX = 500;
export const PROFILE_URL_MAX = 300;

export const PROFILE_LINKS = [
  ['facebookUrl', 'Facebook'],
  ['zaloUrl', 'Zalo'],
  ['instagramUrl', 'Instagram'],
  ['tiktokUrl', 'TikTok'],
  ['websiteUrl', 'Website'],
] as const;

export type ProfileLinkKey = (typeof PROFILE_LINKS)[number][0];

export type UserProfile = {
  avatarMediaId: number | null;
  bio: string;
  facebookUrl: string;
  zaloUrl: string;
  instagramUrl: string;
  tiktokUrl: string;
  websiteUrl: string;
};

export const EMPTY_PROFILE: UserProfile = {
  avatarMediaId: null,
  bio: '',
  facebookUrl: '',
  zaloUrl: '',
  instagramUrl: '',
  tiktokUrl: '',
  websiteUrl: '',
};

export type UserListFilters = {
  query: string;
  role: AdminRole | '';
  status: AdminStatus | '';
  page: number;
};

export type ManagedUser = {
  id: number;
  username: string;
  displayName: string;
  email: string | null;
  role: AdminRole;
  status: AdminStatus;
  lastLoginAt: number | null;
  createdAt: number;
  avatarUrl: string | null;
} & UserProfile;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function emailError(email: string): string | null {
  if (!email) return 'Nhập email.';
  if (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Email không hợp lệ.';
  return null;
}

export function displayNameError(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Nhập họ tên.';
  if (trimmed.length > 80) return 'Họ tên quá dài.';
  return null;
}

export function userInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  const letters = `${first}${last}`.toLocaleUpperCase('vi');
  return letters || '?';
}

export function profileError(profile: UserProfile): string | null {
  if (profile.bio.trim().length > BIO_MAX) return 'Giới thiệu quá dài.';
  for (const [key, label] of PROFILE_LINKS) {
    const value = profile[key].trim();
    if (!value) continue;
    if (value.length > PROFILE_URL_MAX || !isHttpUrl(value)) return `${label} cần bắt đầu bằng http hoặc https.`;
  }
  return null;
}

export function readUserProfile(form: FormData): { profile: UserProfile; avatarInvalid: boolean } {
  const raw = form.get('avatarMediaId');
  let avatarMediaId: number | null = null;
  let avatarInvalid = false;
  if (typeof raw === 'string' && raw !== '') {
    if (/^[1-9]\d*$/.test(raw)) avatarMediaId = Number(raw);
    else avatarInvalid = true;
  }
  return {
    avatarInvalid,
    profile: {
      avatarMediaId,
      bio: String(form.get('bio') ?? ''),
      facebookUrl: String(form.get('facebookUrl') ?? ''),
      zaloUrl: String(form.get('zaloUrl') ?? ''),
      instagramUrl: String(form.get('instagramUrl') ?? ''),
      tiktokUrl: String(form.get('tiktokUrl') ?? ''),
      websiteUrl: String(form.get('websiteUrl') ?? ''),
    },
  };
}

function searchTerm(query: string): string | null {
  const term = query.trim().replace(/[%_]/g, '').slice(0, 80);
  return term ? `%${term}%` : null;
}

export async function listUsers(db: AppDb, filters: UserListFilters) {
  const term = searchTerm(filters.query);
  const conditions = [];
  if (filters.role) conditions.push(eq(adminUsers.role, filters.role));
  if (filters.status) conditions.push(eq(adminUsers.status, filters.status));
  if (term) {
    conditions.push(or(like(adminUsers.displayName, term), like(adminUsers.email, term), like(adminUsers.username, term)));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const page = Math.max(1, filters.page);
  const totalRows = await db.select({ value: count() }).from(adminUsers).where(where);
  const total = totalRows[0]?.value ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / USER_PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const rows = await db
    .select(userColumns)
    .from(adminUsers)
    .leftJoin(media, eq(adminUsers.avatarMediaId, media.id))
    .where(where)
    .orderBy(desc(adminUsers.createdAt), desc(adminUsers.id))
    .limit(USER_PAGE_SIZE)
    .offset((current - 1) * USER_PAGE_SIZE);
  const libraryRows = await db.select({ value: count() }).from(adminUsers);
  return {
    rows: rows.flatMap((row) => {
      const user = parseUser(row);
      return user ? [user] : [];
    }),
    total,
    libraryTotal: libraryRows[0]?.value ?? 0,
    page: current,
    pageCount,
  };
}

export async function getUser(db: AppDb, id: number): Promise<ManagedUser | null> {
  const rows = await db
    .select(userColumns)
    .from(adminUsers)
    .leftJoin(media, eq(adminUsers.avatarMediaId, media.id))
    .where(eq(adminUsers.id, id))
    .limit(1);
  return rows[0] ? parseUser(rows[0]) : null;
}

export function nextUserStatus(current: AdminStatus, requested: AdminStatus): AdminStatus {
  if (current === 'invited' && requested === 'active') return 'invited';
  return requested;
}

export function describeUserChange(
  current: { displayName: string; email: string | null; role: AdminRole; status: AdminStatus } & UserProfile,
  input: { displayName: string; email: string; role: AdminRole; status: AdminStatus } & UserProfile,
): { action: 'user.update' | 'user.disable'; summary: string } | null {
  const name = input.displayName.trim();
  const email = normalizeEmail(input.email);
  const status = nextUserStatus(current.status, input.status);
  const accountSame = current.displayName === name && current.email === email && current.role === input.role && current.status === status;
  if (accountSame && sameProfile(current, input)) return null;
  const label = activityText(name, 80);
  if (status === 'disabled' && current.status !== 'disabled') return { action: 'user.disable', summary: `Đã khóa tài khoản ${label}.` };
  if (current.role !== input.role) return { action: 'user.update', summary: `Đã đổi vai trò ${label} thành ${ROLE_LABELS[input.role]}.` };
  if (current.status === 'disabled' && status === 'active') return { action: 'user.update', summary: `Đã mở khóa tài khoản ${label}.` };
  return { action: 'user.update', summary: `Đã cập nhật tài khoản ${label}.` };
}

export async function createUser(
  db: AppDb,
  input: { displayName: string; email: string; role: AdminRole },
  now = Date.now(),
  actor?: ActivityActor,
): Promise<{ ok: true; id: number; token: string; expiresAt: number } | { ok: false; error: string }> {
  const name = input.displayName.trim();
  const email = normalizeEmail(input.email);
  const nameError = displayNameError(name);
  if (nameError) return { ok: false, error: nameError };
  const invalidEmail = emailError(email);
  if (invalidEmail) return { ok: false, error: invalidEmail };
  const taken = await findIdentity(db, email);
  if (taken) return { ok: false, error: 'Email đã được dùng.' };
  const passwordHash = await hashPassword(randomToken());
  await commitWrites(db, [
    db.insert(adminUsers).values({
      username: email,
      displayName: name,
      email,
      role: input.role,
      status: 'invited',
      passwordHash,
      createdAt: now,
      updatedAt: now,
    }),
    ...(actor
      ? [
          activityWrite(
            db,
            {
              actorId: actor.id,
              actorName: actor.name,
              action: 'user.create',
              objectType: 'user',
              objectId: null,
              summary: `Đã tạo tài khoản ${activityText(name, 80)}, vai trò ${ROLE_LABELS[input.role]}.`,
              createdAt: now,
              useLastInsertId: true,
            },
            true,
          ),
        ]
      : []),
  ]);
  const created = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, email)).limit(1);
  const id = created[0]?.id;
  if (!id) return { ok: false, error: 'Không tạo được tài khoản.' };
  const issued = await issuePasswordReset(db, id, now);
  if (!issued.ok) return issued;
  return { ok: true, id, token: issued.token, expiresAt: issued.expiresAt };
}

export async function updateUser(
  db: AppDb,
  id: number,
  input: { displayName: string; email: string; role: AdminRole; status: AdminStatus } & UserProfile,
  now = Date.now(),
  actor?: ActivityActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const current = await getUser(db, id);
  if (!current) return { ok: false, error: 'Không tìm thấy tài khoản.' };
  const name = input.displayName.trim();
  const email = normalizeEmail(input.email);
  const nameError = displayNameError(name);
  if (nameError) return { ok: false, error: nameError };
  const invalidEmail = emailError(email);
  if (invalidEmail) return { ok: false, error: invalidEmail };
  const invalidProfile = profileError(input);
  if (invalidProfile) return { ok: false, error: invalidProfile };
  if (input.avatarMediaId !== null) {
    const avatar = await db.select({ id: media.id }).from(media).where(eq(media.id, input.avatarMediaId)).limit(1);
    if (!avatar[0]) return { ok: false, error: 'Ảnh không còn trong thư viện.' };
  }
  if (email !== current.email) {
    const taken = await findIdentity(db, email, id);
    if (taken) return { ok: false, error: 'Email đã được dùng.' };
  }
  const nextStatus = nextUserStatus(current.status, input.status);
  const change = describeUserChange(current, input);
  if (!change) return { ok: true };
  const staysActiveAdmin = input.role === 'admin' && nextStatus === 'active';
  const others = await db
    .select({ value: count() })
    .from(adminUsers)
    .where(and(eq(adminUsers.role, 'admin'), eq(adminUsers.status, 'active'), ne(adminUsers.id, id)));
  const blocked = roleChangeError({
    wasActiveAdmin: current.role === 'admin' && current.status === 'active',
    staysActiveAdmin,
    otherActiveAdmins: others[0]?.value ?? 0,
  });
  if (blocked) return { ok: false, error: blocked };
  await commitWrites(db, [
    ...(nextStatus === 'disabled' && current.status !== 'disabled'
      ? [db.delete(sessions).where(eq(sessions.adminUserId, id))]
      : []),
    db
      .update(adminUsers)
      .set({
        displayName: name,
        email,
        username: current.username === current.email ? email : current.username,
        role: input.role,
        status: nextStatus,
        avatarMediaId: input.avatarMediaId,
        bio: input.bio.trim(),
        facebookUrl: storedUrl(input.facebookUrl),
        zaloUrl: storedUrl(input.zaloUrl),
        instagramUrl: storedUrl(input.instagramUrl),
        tiktokUrl: storedUrl(input.tiktokUrl),
        websiteUrl: storedUrl(input.websiteUrl),
        updatedAt: now,
      })
      .where(eq(adminUsers.id, id)),
    ...(actor
      ? [
          activityWrite(
            db,
            {
              actorId: actor.id,
              actorName: actor.name,
              action: change.action,
              objectType: 'user',
              objectId: String(id),
              summary: change.summary,
              createdAt: now,
            },
            true,
          ),
        ]
      : []),
  ]);
  return { ok: true };
}

export async function issuePasswordReset(
  db: AppDb,
  userId: number,
  now = Date.now(),
): Promise<{ ok: true; token: string; expiresAt: number } | { ok: false; error: string }> {
  const user = await getUser(db, userId);
  if (!user) return { ok: false, error: 'Không tìm thấy tài khoản.' };
  if (user.status === 'disabled') return { ok: false, error: 'Tài khoản đang khóa.' };
  const token = randomToken();
  const expiresAt = now + RESET_MS;
  await db
    .update(passwordResets)
    .set({ usedAt: now })
    .where(and(eq(passwordResets.userId, userId), sql`${passwordResets.usedAt} is null`));
  await db.insert(passwordResets).values({
    userId,
    tokenHash: await hashToken(token),
    expiresAt,
    createdAt: now,
  });
  return { ok: true, token, expiresAt };
}

export async function consumePasswordReset(
  db: AppDb,
  token: string,
  password: string,
  now = Date.now(),
): Promise<{ ok: true; userId: number; role: AdminRole } | { ok: false; error: string }> {
  const invalid = passwordError(password);
  if (invalid) return { ok: false, error: invalid };
  const rows = await db
    .select({
      id: passwordResets.id,
      userId: passwordResets.userId,
      expiresAt: passwordResets.expiresAt,
      usedAt: passwordResets.usedAt,
      status: adminUsers.status,
      role: adminUsers.role,
      displayName: adminUsers.displayName,
    })
    .from(passwordResets)
    .innerJoin(adminUsers, eq(adminUsers.id, passwordResets.userId))
    .where(eq(passwordResets.tokenHash, await hashToken(token)))
    .limit(1);
  const reset = rows[0];
  if (!reset || reset.usedAt !== null || reset.expiresAt <= now) return { ok: false, error: 'Liên kết không còn hiệu lực.' };
  if (reset.status === 'disabled' || !isAdminRole(reset.role)) return { ok: false, error: 'Tài khoản đang khóa.' };
  const passwordHash = await hashPassword(password);
  await commitWrites(db, [
    db.update(passwordResets).set({ usedAt: now }).where(eq(passwordResets.id, reset.id)),
    db
      .update(adminUsers)
      .set({ passwordHash, status: 'active', updatedAt: now })
      .where(eq(adminUsers.id, reset.userId)),
    db.delete(sessions).where(eq(sessions.adminUserId, reset.userId)),
    activityWrite(
      db,
      {
        actorId: reset.userId,
        actorName: actorLabel(reset.displayName, reset.userId),
        action: 'password.change',
        objectType: 'user',
        objectId: String(reset.userId),
        summary: 'Đã đặt mật khẩu.',
        createdAt: now,
      },
      false,
    ),
  ]);
  return { ok: true, userId: reset.userId, role: reset.role };
}

export async function changeOwnPassword(
  db: AppDb,
  userId: number,
  sessionId: string,
  currentPassword: string,
  nextPassword: string,
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const invalid = passwordError(nextPassword);
  if (invalid) return { ok: false, error: invalid };
  const rows = await db
    .select({ passwordHash: adminUsers.passwordHash, displayName: adminUsers.displayName })
    .from(adminUsers)
    .where(eq(adminUsers.id, userId))
    .limit(1);
  const user = rows[0];
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
    return { ok: false, error: 'Mật khẩu hiện tại không đúng.' };
  }
  await commitWrites(db, [
    db.update(adminUsers).set({ passwordHash: await hashPassword(nextPassword), updatedAt: now }).where(eq(adminUsers.id, userId)),
    db.delete(sessions).where(and(eq(sessions.adminUserId, userId), ne(sessions.id, sessionId))),
    activityWrite(
      db,
      {
        actorId: userId,
        actorName: actorLabel(user.displayName, userId),
        action: 'password.change',
        objectType: 'user',
        objectId: String(userId),
        summary: 'Đã đổi mật khẩu.',
        createdAt: now,
      },
      false,
    ),
  ]);
  return { ok: true };
}

export async function revokeUserSessions(db: AppDb, userId: number, actor?: ActivityActor): Promise<boolean> {
  const rows = await db
    .select({ id: sessions.id, displayName: adminUsers.displayName })
    .from(sessions)
    .innerJoin(adminUsers, eq(adminUsers.id, sessions.adminUserId))
    .where(eq(sessions.adminUserId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) return false;
  await commitWrites(db, [
    db.delete(sessions).where(eq(sessions.adminUserId, userId)),
    ...(actor
      ? [
          activityWrite(
            db,
            {
              actorId: actor.id,
              actorName: actor.name,
              action: 'session.revoke',
              objectType: 'user',
              objectId: String(userId),
              summary: `Đã thu hồi phiên của ${activityText(row.displayName, 80) || `Tài khoản #${userId}`}.`,
              createdAt: Date.now(),
            },
            true,
          ),
        ]
      : []),
  ]);
  return true;
}

async function findIdentity(db: AppDb, email: string, exceptId?: number) {
  const rows = await db
    .select({ id: adminUsers.id })
    .from(adminUsers)
    .where(or(eq(adminUsers.email, email), eq(adminUsers.username, email)))
    .limit(1);
  const row = rows[0];
  if (!row || row.id === exceptId) return null;
  return row;
}

const userColumns = {
  id: adminUsers.id,
  username: adminUsers.username,
  displayName: adminUsers.displayName,
  email: adminUsers.email,
  role: adminUsers.role,
  status: adminUsers.status,
  lastLoginAt: adminUsers.lastLoginAt,
  createdAt: adminUsers.createdAt,
  avatarMediaId: adminUsers.avatarMediaId,
  avatarKey: media.r2Key,
  bio: adminUsers.bio,
  facebookUrl: adminUsers.facebookUrl,
  zaloUrl: adminUsers.zaloUrl,
  instagramUrl: adminUsers.instagramUrl,
  tiktokUrl: adminUsers.tiktokUrl,
  websiteUrl: adminUsers.websiteUrl,
};

function parseUser(row: {
  id: number;
  username: string;
  displayName: string;
  email: string | null;
  role: string;
  status: string;
  lastLoginAt: number | null;
  createdAt: number;
  avatarMediaId: number | null;
  avatarKey: string | null;
  bio: string;
  facebookUrl: string | null;
  zaloUrl: string | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;
  websiteUrl: string | null;
}): ManagedUser | null {
  if (!isAdminRole(row.role) || !isAdminStatus(row.status)) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    email: row.email,
    role: row.role,
    status: row.status,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
    avatarMediaId: row.avatarMediaId,
    avatarUrl: row.avatarKey ? routes.media(row.avatarKey) : null,
    bio: row.bio,
    facebookUrl: row.facebookUrl ?? '',
    zaloUrl: row.zaloUrl ?? '',
    instagramUrl: row.instagramUrl ?? '',
    tiktokUrl: row.tiktokUrl ?? '',
    websiteUrl: row.websiteUrl ?? '',
  };
}

function storedUrl(value: string): string | null {
  const text = value.trim();
  return text || null;
}

function sameProfile(current: UserProfile, input: UserProfile): boolean {
  return (
    current.avatarMediaId === input.avatarMediaId &&
    current.bio.trim() === input.bio.trim() &&
    PROFILE_LINKS.every(([key]) => current[key].trim() === input[key].trim())
  );
}
