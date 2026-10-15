const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export type ImageKind = { mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; extension: '.jpg' | '.png' | '.webp' };

export function detectImageType(bytes: Uint8Array): ImageKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: '.jpg' };
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { mimeType: 'image/png', extension: '.png' };
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { mimeType: 'image/webp', extension: '.webp' };
  }
  return null;
}

export function imageSizeError(bytes: number): string | null {
  if (bytes <= 0) return 'Tệp ảnh trống.';
  if (bytes > MAX_IMAGE_BYTES) return 'Ảnh lớn hơn 2 MB.';
  return null;
}

export function displayFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? 'anh';
  const cleaned = base.replace(/[^\w.\- ]+/g, '').trim().slice(0, 80);
  return cleaned || 'anh';
}

const SHARE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export function mediaKeyFromPublicUrl(value: string): string | null {
  let pathname = value;
  try {
    pathname = value.startsWith('/') ? value : new URL(value).pathname;
  } catch {
    return null;
  }
  if (!pathname.startsWith('/media/')) return null;
  let key = pathname.slice('/media/'.length);
  try {
    key = decodeURIComponent(key);
  } catch {
    return null;
  }
  if (!key || key.includes('..') || key.startsWith('/') || key.includes('\\')) return null;
  return key;
}

export async function shareImageType(
  bucket: { head(key: string): Promise<{ httpMetadata?: { contentType?: string } } | null> },
  url: string,
): Promise<string | null> {
  const key = mediaKeyFromPublicUrl(url);
  if (!key) return null;
  try {
    const head = await bucket.head(key);
    if (!head) return null;
    const mime = head.httpMetadata?.contentType ?? '';
    if (mime && !SHARE_IMAGE_TYPES.has(mime)) return null;
    return mime;
  } catch {
    return null;
  }
}

export function readRasterSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return boxSize(readU32(bytes, 16), readU32(bytes, 20));
  }
  if (
    bytes.length >= 30 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    const kind = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (kind === 'VP8X') {
      return boxSize(1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16));
    }
    if (kind === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return boxSize((bytes[26] | (bytes[27] << 8)) & 0x3fff, (bytes[28] | (bytes[29] << 8)) & 0x3fff);
    }
    if (kind === 'VP8L' && bytes[20] === 0x2f) {
      const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
      return boxSize((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
    }
  }
  return jpegSize(bytes);
}

function boxSize(width: number, height: number): { width: number; height: number } | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 8000 || height > 8000) return null;
  return { width, height };
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
}

function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.length) return null;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return boxSize((bytes[offset + 7] << 8) | bytes[offset + 8], (bytes[offset + 5] << 8) | bytes[offset + 6]);
    }
    offset += 2 + length;
  }
  return null;
}

export function mediaObjectKey(extension: ImageKind['extension'], now = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}/${month}/${crypto.randomUUID()}${extension}`;
}
