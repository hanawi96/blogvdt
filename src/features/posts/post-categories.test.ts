import { describe, expect, it } from 'vitest';
import { parseCategoryIds, primaryCategoryId, sameCategoryIds } from './post-categories';

describe('post categories', () => {
  it('parse checkbox ids, bỏ trùng, từ chối sai kiểu', () => {
    const form = new FormData();
    form.append('categoryIds', '2');
    form.append('categoryIds', '2');
    form.append('categoryIds', '5');
    const ok = parseCategoryIds(form);
    expect(ok).toEqual({ ok: true, ids: [2, 5] });

    const bad = new FormData();
    bad.append('categoryIds', 'abc');
    expect(parseCategoryIds(bad).ok).toBe(false);
  });

  it('primary là id nhỏ nhất; so khớp không phụ thuộc thứ tự', () => {
    expect(primaryCategoryId([])).toBeNull();
    expect(primaryCategoryId([9, 2, 4])).toBe(2);
    expect(sameCategoryIds([1, 3], [3, 1])).toBe(true);
    expect(sameCategoryIds([1], [1, 2])).toBe(false);
  });
});
