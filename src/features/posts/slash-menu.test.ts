import { describe, expect, it } from 'vitest';
import { clampSlashIndex, filterSlashCommands, findSlashMatch } from './slash-menu';

describe('slash menu', () => {
  it('nhận / ở đầu block hoặc sau khoảng trắng', () => {
    expect(findSlashMatch('/')).toEqual({ offset: 0, query: '' });
    expect(findSlashMatch('/anh')).toEqual({ offset: 0, query: 'anh' });
    expect(findSlashMatch('xin /bang')).toEqual({ offset: 4, query: 'bang' });
    expect(findSlashMatch('a/b')).toBeNull();
    expect(findSlashMatch('http://x')).toBeNull();
  });

  it('lọc theo alias không dấu, ưu tiên khớp đầu', () => {
    const anh = filterSlashCommands('ảnh');
    expect(anh[0]?.id).toBe('image');
    const bang = filterSlashCommands('bang');
    expect(bang[0]?.id).toBe('table');
    const sp = filterSlashCommands('sp');
    expect(sp.some((item) => item.id === 'products')).toBe(true);
    expect(filterSlashCommands('zzzz')).toEqual([]);
  });

  it('clamp index vòng quanh danh sách', () => {
    expect(clampSlashIndex(0, 3)).toBe(0);
    expect(clampSlashIndex(3, 3)).toBe(0);
    expect(clampSlashIndex(-1, 3)).toBe(2);
    expect(clampSlashIndex(0, 0)).toBe(0);
  });
});
