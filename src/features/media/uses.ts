import { routes } from '../../lib/routes';
import type { MediaUse } from './types';

type MediaKey = { id: number; key: string };
type PostUse = { id: number; title: string; coverMediaId: number | null; contentJson: string };
type ProductUse = { id: number; name: string; coverMediaId: number | null };
type AlbumUse = { mediaId: number; productId: number; productName: string };

export function collectMediaUses(input: {
  media: MediaKey[];
  posts: PostUse[];
  products: ProductUse[];
  album: AlbumUse[];
  logoId: string;
  faviconId: string;
}): Record<string, MediaUse[]> {
  const uses = new Map<number, MediaUse[]>();
  const add = (id: number | null, use: MediaUse) => {
    if (!id) return;
    const list = uses.get(id) ?? [];
    if (list.some((item) => item.href === use.href && item.label === use.label)) return;
    list.push(use);
    uses.set(id, list);
  };

  for (const post of input.posts) {
    const use = { href: routes.adminPost(post.id), label: post.title };
    add(post.coverMediaId, use);
    for (const item of input.media) {
      if (post.contentJson.includes(`/media/${item.key}`)) add(item.id, use);
    }
  }
  for (const product of input.products) {
    add(product.coverMediaId, { href: routes.adminProduct(product.id), label: product.name });
  }
  for (const image of input.album) {
    add(image.mediaId, { href: routes.adminProduct(image.productId), label: image.productName });
  }
  add(Number(input.logoId), { href: routes.adminSettings, label: 'Logo' });
  add(Number(input.faviconId), { href: routes.adminSettings, label: 'Favicon' });

  return Object.fromEntries([...uses].map(([id, list]) => [String(id), list]));
}
