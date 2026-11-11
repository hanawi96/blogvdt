import { describe, expect, it } from 'vitest';
import {
  detectImageType,
  displayFilename,
  imageSizeError,
  mediaKeyFromPublicUrl,
  cardKeyFromOriginal,
  listingMediaKey,
  mediaObjectKeys,
  readRasterSize,
  shareImageType,
  thumbKeyFromOriginal,
  variantKeysForStoredKey,
} from './files';

describe('tệp ảnh', () => {
  it('nhận jpeg, png, webp và từ chối svg', () => {
    expect(detectImageType(new Uint8Array([0xff, 0xd8, 0xff, 0x00]))?.mimeType).toBe('image/jpeg');
    expect(detectImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.mimeType).toBe('image/png');
    const webp = new Uint8Array(12);
    webp.set([0x52, 0x49, 0x46, 0x46], 0);
    webp.set([0x57, 0x45, 0x42, 0x50], 8);
    expect(detectImageType(webp)?.extension).toBe('.webp');
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(detectImageType(svg)).toBeNull();
  });

  it('chỉ nhận ảnh chia sẻ còn object và đúng kiểu', async () => {
    expect(mediaKeyFromPublicUrl('https://vongdautam.vn/media/2026/10/a.webp')).toBe('2026/10/a.webp');
    expect(mediaKeyFromPublicUrl('/media/../admin')).toBeNull();
    const bucket = {
      async head(key: string) {
        if (key === '2026/10/a.webp') return { httpMetadata: { contentType: 'image/webp' } };
        if (key === '2026/10/a.svg') return { httpMetadata: { contentType: 'image/svg+xml' } };
        return null;
      },
    };
    expect(await shareImageType(bucket, 'https://vongdautam.vn/media/2026/10/a.webp')).toBe('image/webp');
    expect(await shareImageType(bucket, 'https://vongdautam.vn/media/2026/10/a.svg')).toBeNull();
    expect(await shareImageType(bucket, 'https://vongdautam.vn/media/missing.webp')).toBeNull();
  });

  it('đọc kích thước từ header, không giải mã cả ảnh', () => {
    const webp = new Uint8Array(30);
    webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58], 0);
    webp.set([0xaf, 0x04, 0x00, 0xaf, 0x04, 0x00], 24);
    expect(readRasterSize(webp)).toEqual({ width: 1200, height: 1200 });
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47], 0);
    png[16] = 0;
    png[17] = 0;
    png[18] = 0x03;
    png[19] = 0x20;
    png[20] = 0;
    png[21] = 0;
    png[22] = 0x02;
    png[23] = 0x58;
    expect(readRasterSize(png)).toEqual({ width: 800, height: 600 });
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x08, 0x08, 0x01, 0x2c, 0x01, 0x90, 0x00]);
    expect(readRasterSize(jpeg)).toEqual({ width: 400, height: 300 });
    expect(readRasterSize(new Uint8Array([0x3c, 0x73, 0x76, 0x67]))).toBeNull();
  });

  it('chặn ảnh quá lớn và làm sạch tên tệp', () => {
    expect(imageSizeError(2 * 1024 * 1024 + 1)).toBe('Ảnh lớn hơn 2 MB.');
    expect(displayFilename('C:\\anh\\vong dep!.png')).toBe('vong dep.png');
  });

  it('đặt key R2 original/card/thumb cùng uuid trong thư mục rõ ràng', () => {
    const fixed = new Date(Date.UTC(2026, 10, 11));
    const keys = mediaObjectKeys('.webp', fixed, '11111111-2222-4333-8444-555555555555');
    expect(keys.original).toBe('original/2026/11/11111111-2222-4333-8444-555555555555.webp');
    expect(keys.card).toBe('card/2026/11/11111111-2222-4333-8444-555555555555.webp');
    expect(keys.thumb).toBe('thumb/2026/11/11111111-2222-4333-8444-555555555555.webp');
    expect(cardKeyFromOriginal(keys.original)).toBe(keys.card);
    expect(thumbKeyFromOriginal(keys.original)).toBe(keys.thumb);
    expect(thumbKeyFromOriginal('2026/10/a.webp')).toBeNull();
    expect(listingMediaKey(keys.original, keys.card)).toBe(keys.card);
    expect(listingMediaKey(keys.original, null)).toBe(keys.original);
    expect(variantKeysForStoredKey('2026/10/11111111-2222-4333-8444-555555555555.webp')).toEqual({
      card: 'card/2026/10/11111111-2222-4333-8444-555555555555.webp',
      thumb: 'thumb/2026/10/11111111-2222-4333-8444-555555555555.webp',
    });
  });
});
