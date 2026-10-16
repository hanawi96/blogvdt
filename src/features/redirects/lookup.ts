import { and, eq } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { findRedirect } from '../../lib/db/redirects';
import { categories, posts, products } from '../../lib/db/schema';
import { getPublicTagBySlug } from '../posts/public';
import { categorySlug, knowledgeSlug, tagSlug } from '../posts/redirects';
import { livePublished } from '../posts/visibility';
import { isStaticPublicPath, isSystemPath, productSlug, redirectOutcome, skipsRedirectLookup, type PublicRedirect } from './rules';

export async function publicPathExists(db: AppDb, path: string): Promise<boolean> {
  if (!path || isSystemPath(path)) return false;
  if (isStaticPublicPath(path)) return true;
  const post = knowledgeSlug(path);
  if (post) {
    const rows = await db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.slug, post), livePublished()))
      .limit(1);
    return Boolean(rows[0]);
  }
  const category = categorySlug(path);
  if (category) {
    const rows = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, category)).limit(1);
    return Boolean(rows[0]);
  }
  const tag = tagSlug(path);
  if (tag) {
    return Boolean(await getPublicTagBySlug(db, tag));
  }
  const product = productSlug(path);
  if (product) {
    const rows = await db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.slug, product), eq(products.status, 'active')))
      .limit(1);
    return Boolean(rows[0]);
  }
  return false;
}

export async function resolvePublicRedirect(db: AppDb, currentPath: string): Promise<PublicRedirect | null> {
  if (skipsRedirectLookup(currentPath)) return null;
  const hit = await findRedirect(db, currentPath);
  if (!hit || hit.enabled !== 1) return null;
  if (hit.statusCode === 410) return { type: 'gone' };
  const destinationPublic = await publicPathExists(db, hit.toPath);
  return redirectOutcome(hit, currentPath, destinationPublic);
}
