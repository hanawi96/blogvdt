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

export function mediaObjectKey(extension: ImageKind['extension'], now = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}/${month}/${crypto.randomUUID()}${extension}`;
}
