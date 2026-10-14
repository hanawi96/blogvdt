import { routes } from '../../lib/routes';
import type { MediaItem } from '../../features/media/types';
import { resizeImage } from './resize-image';

export async function uploadMedia(csrf: string, file: File): Promise<MediaItem> {
  const image = await resizeImage(file);
  const body = new FormData();
  body.set('csrf', csrf);
  body.set('file', image.file, image.file.name);
  body.set('alt', '');
  body.set('width', String(image.width));
  body.set('height', String(image.height));
  const response = await fetch(routes.adminMedia, {
    method: 'POST',
    headers: { accept: 'application/json' },
    body,
  });
  const payload = (await response.json()) as Partial<MediaItem> & { error?: string };
  if (!response.ok || !payload.id || !payload.url) throw new Error(payload.error ?? 'Không lưu được ảnh.');
  const item: MediaItem = {
    id: payload.id,
    url: payload.url,
    alt: payload.alt ?? '',
    filename: payload.filename ?? image.file.name,
    width: payload.width ?? image.width,
    height: payload.height ?? image.height,
    sizeBytes: payload.sizeBytes ?? image.file.size,
    createdAt: payload.createdAt ?? Date.now(),
  };
  window.dispatchEvent(new CustomEvent('media-uploaded', { detail: item }));
  return item;
}
