import { routes } from '../../lib/routes';
import type { MediaUse } from './types';

type MediaKey = { id: number; key: string };
type PostUse = { id: number; title: string; coverMediaId: number | null; contentJson: string };
type ProductUse = { id: number; name: string; coverMediaId: number | null };
type AlbumUse = { mediaId: number; productId: number; productName: string };
type CategoryUse = { id: number; name: string; description: string | null };

/** Trích key R2 từ HTML/JSON có đường dẫn /media/... */
export function extractMediaKeysFromText(text: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const re = /\/media\/([^\s"'<>\\]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const key = match[1];
    if (!key || key.includes('..') || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

export function collectMediaUses(input: {
  media: MediaKey[];
  posts: PostUse[];
  products: ProductUse[];
  album: AlbumUse[];
  logoId: string;
  faviconId: string;
  ogImageId: string;
  avatars?: { mediaId: number | null; userId: number; name: string }[];
  categories?: CategoryUse[];
  productCategoryCovers?: { id: number; name: string; coverMediaId: number | null }[];
}): Record<string, MediaUse[]> {
  const uses = new Map<number, MediaUse[]>();
  const add = (id: number | null, use: MediaUse) => {
    if (!id) return;
    const list = uses.get(id) ?? [];
    if (list.some((item) => item.href === use.href && item.label === use.label)) return;
    list.push(use);
    uses.set(id, list);
  };

  const keyToIds = new Map<string, number[]>();
  for (const item of input.media) {
    const list = keyToIds.get(item.key) ?? [];
    list.push(item.id);
    keyToIds.set(item.key, list);
  }
  const addByKey = (key: string, use: MediaUse) => {
    for (const id of keyToIds.get(key) ?? []) add(id, use);
  };

  for (const post of input.posts) {
    const use = { href: routes.adminPost(post.id), label: post.title };
    add(post.coverMediaId, use);
    for (const key of extractMediaKeysFromText(post.contentJson)) addByKey(key, use);
  }
  for (const product of input.products) {
    add(product.coverMediaId, { href: routes.adminProduct(product.id), label: product.name });
  }
  for (const image of input.album) {
    add(image.mediaId, { href: routes.adminProduct(image.productId), label: image.productName });
  }
  add(Number(input.logoId), { href: routes.adminSettings, label: 'Logo' });
  add(Number(input.faviconId), { href: routes.adminSettings, label: 'Favicon' });
  add(Number(input.ogImageId), { href: routes.adminSettings, label: 'Ảnh chia sẻ' });
  for (const avatar of input.avatars ?? []) {
    add(avatar.mediaId, { href: routes.adminUser(avatar.userId), label: avatar.name || `Tài khoản #${avatar.userId}` });
  }
  for (const category of input.productCategoryCovers ?? []) {
    add(category.coverMediaId, {
      href: `${routes.adminProductCategories}?edit=${category.id}`,
      label: category.name || `Danh mục sản phẩm #${category.id}`,
    });
  }
  for (const category of input.categories ?? []) {
    const text = category.description ?? '';
    if (!text.includes('/media/')) continue;
    const use = { href: routes.adminCategories, label: category.name || `Danh mục #${category.id}` };
    for (const key of extractMediaKeysFromText(text)) addByKey(key, use);
  }

  return Object.fromEntries([...uses].map(([id, list]) => [String(id), list]));
}
