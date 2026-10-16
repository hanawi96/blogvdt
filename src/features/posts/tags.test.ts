import { describe, expect, it } from 'vitest';
import { isTagRobots, tagDeleteWarning, tagRedirect } from './tags';
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
