import { and, eq } from 'drizzle-orm';
import type { AdminRole } from '../auth/access';
import { userInitials } from '../auth/users';
import type { AppDb } from '../../lib/db/client';
import { adminUsers, media } from '../../lib/db/schema';
import { isHttpUrl } from '../../lib/http';
import { routes } from '../../lib/routes';

export type PublicPostAuthor = {
  id: number;
  name: string;
  initials: string;
  roleLabel: string;
  bio: string;
  avatarUrl: string | null;
  moreUrl: string | null;
};

const PUBLIC_ROLE_LABEL: Record<AdminRole, string> = {
  editor: 'Biên tập viên',
  admin: 'Người viết',
};

export async function getPublicPostAuthor(db: AppDb, authorId: number | null): Promise<PublicPostAuthor | null> {
  if (authorId == null || !Number.isInteger(authorId) || authorId < 1) return null;
  const rows = await db
    .select({
      id: adminUsers.id,
      displayName: adminUsers.displayName,
      bio: adminUsers.bio,
      role: adminUsers.role,
      websiteUrl: adminUsers.websiteUrl,
      facebookUrl: adminUsers.facebookUrl,
      zaloUrl: adminUsers.zaloUrl,
      instagramUrl: adminUsers.instagramUrl,
      tiktokUrl: adminUsers.tiktokUrl,
      avatarKey: media.r2Key,
    })
    .from(adminUsers)
    .leftJoin(media, eq(adminUsers.avatarMediaId, media.id))
    .where(and(eq(adminUsers.id, authorId), eq(adminUsers.status, 'active')))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const name = row.displayName.trim() || 'Tác giả';
  return {
    id: row.id,
    name,
    initials: userInitials(name),
    roleLabel: PUBLIC_ROLE_LABEL[row.role as AdminRole] ?? 'Người viết',
    bio: row.bio.trim(),
    avatarUrl: row.avatarKey ? routes.media(row.avatarKey) : null,
    moreUrl: firstPublicLink([row.websiteUrl, row.facebookUrl, row.zaloUrl, row.instagramUrl, row.tiktokUrl]),
  };
}

function firstPublicLink(values: Array<string | null>): string | null {
  for (const value of values) {
    const href = value?.trim() ?? '';
    if (href && isHttpUrl(href)) return href;
  }
  return null;
}
