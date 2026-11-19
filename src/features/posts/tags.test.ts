import { describe, expect, it } from 'vitest';
import {
  isTagRobots,
  readTagBulkIds,
  TAG_BULK_MAX,
  tagAdminQuery,
  tagBulkDeleteWarning,
  tagDeleteWarning,
  tagRedirect,
} from './tags';
import { parseTagIds, sameTagIds } from './post-tags';

describe('thẻ bài viết', () => {
  it('chỉ tạo redirect khi slug đổi', () => {
    expect(tagRedirect('vong-dau-tam', 'vong-dau-tam')).toBeNull();
    expect(tagRedirect('vong-dau-tam', 'vong-me-be')).toEqual({
      from: '/tag/vong-dau-tam',
      to: '/tag/vong-me-be',
    });
  });

  it('cảnh báo số bài trước khi xóa và không nói là xóa bài', () => {
    expect(tagDeleteWarning(0)).toBe('Xóa thẻ này?');
    expect(tagDeleteWarning(1)).toContain('1 bài viết');
    expect(tagDeleteWarning(3)).toContain('3 bài viết');
    expect(tagDeleteWarning(3)).toContain('giữ lại');
    expect(tagDeleteWarning(3)).not.toMatch(/xóa bài/i);
  });

  it('cảnh báo xóa hàng loạt', () => {
    expect(tagBulkDeleteWarning(0)).toContain('Chọn thẻ');
    expect(tagBulkDeleteWarning(1)).toContain('1 thẻ');
    expect(tagBulkDeleteWarning(4)).toContain('4 thẻ');
    expect(tagBulkDeleteWarning(4)).toContain('giữ lại');
  });

  it('đọc id checkbox hàng loạt: lọc trùng, bỏ ID sai, từ chối rỗng và quá giới hạn', () => {
    const form = new FormData();
    for (const id of ['3', '3', '7', 'abc', '-1', '2.5', '0']) form.append('ids', id);
    expect(readTagBulkIds(form)).toEqual([3, 7]);

    expect(readTagBulkIds(new FormData())).toBe(null);

    const many = new FormData();
    for (let id = 1; id <= TAG_BULK_MAX + 1; id += 1) many.append('ids', String(id));
    expect(readTagBulkIds(many)).toBe(null);

    const exact = new FormData();
    for (let id = 1; id <= TAG_BULK_MAX; id += 1) exact.append('ids', String(id));
    expect(readTagBulkIds(exact)).toHaveLength(TAG_BULK_MAX);
  });

  it('ghép URL danh sách thẻ sau thao tác hàng loạt', () => {
    expect(tagAdminQuery({ query: 'dâu', bulk: { count: 2 } })).toBe('/admin/tags?q=d%C3%A2u&bulk=delete&n=2');
    expect(tagAdminQuery({ bulk: 'error' })).toBe('/admin/tags?error=bulk');
    expect(tagAdminQuery({ saved: true })).toBe('/admin/tags?saved=1');
  });

  it('robots chỉ nhận index | noindex', () => {
    expect(isTagRobots('index')).toBe(true);
    expect(isTagRobots('noindex')).toBe(true);
    expect(isTagRobots('nofollow')).toBe(false);
    expect(isTagRobots('')).toBe(false);
  });
});

describe('post tags helpers', () => {
  it('parse checkbox ids, bỏ trùng, từ chối sai kiểu', () => {
    const form = new FormData();
    form.append('tagIds', '2');
    form.append('tagIds', '2');
    form.append('tagIds', '7');
    expect(parseTagIds(form)).toEqual({ ok: true, ids: [2, 7] });

    const bad = new FormData();
    bad.append('tagIds', 'abc');
    expect(parseTagIds(bad).ok).toBe(false);
  });

  it('chặn quá số thẻ tối đa mỗi bài', () => {
    const form = new FormData();
    for (let id = 1; id <= 11; id += 1) form.append('tagIds', String(id));
    const parsed = parseTagIds(form);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/tối đa/i);
  });

  it('so khớp id không phụ thuộc thứ tự', () => {
    expect(sameTagIds([1, 4], [4, 1])).toBe(true);
    expect(sameTagIds([1], [1, 2])).toBe(false);
  });
});
