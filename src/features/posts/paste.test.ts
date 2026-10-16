import { describe, expect, it } from 'vitest';
import { firstClipboardImage, isLoneHref } from './paste';

describe('paste helpers', () => {
  it('nhận đúng một href nội bộ hoặc http', () => {
    expect(isLoneHref('/san-pham/vong-tron')).toBe(true);
    expect(isLoneHref('https://example.com/a')).toBe(true);
    expect(isLoneHref('/mau-vong-dau-tam')).toBe(true);
    expect(isLoneHref('xem /san-pham/x')).toBe(false);
    expect(isLoneHref('javascript:alert(1)')).toBe(false);
  });

  it('lấy file ảnh đầu tiên từ FileList giả', () => {
    const image = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' });
    const other = new File([new Uint8Array([1])], 'a.txt', { type: 'text/plain' });
    const list = {
      length: 2,
      0: other,
      1: image,
      item: (i: number) => (i === 0 ? other : image),
      *[Symbol.iterator]() {
        yield other;
        yield image;
      },
    } as unknown as FileList;
    expect(firstClipboardImage(list)?.name).toBe('a.png');
    expect(firstClipboardImage(null)).toBeNull();
  });
});
