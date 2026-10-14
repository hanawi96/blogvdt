import { describe, expect, it } from 'vitest';
import { detectImageType, displayFilename, imageSizeError } from './files';

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

  it('chặn ảnh quá lớn và làm sạch tên tệp', () => {
    expect(imageSizeError(2 * 1024 * 1024 + 1)).toBe('Ảnh lớn hơn 2 MB.');
    expect(displayFilename('C:\\anh\\vong dep!.png')).toBe('vong dep.png');
  });
});
