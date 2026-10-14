import { describe, expect, it } from 'vitest';
import { isPostStatus } from './status';

describe('trạng thái bài viết', () => {
  it('chỉ nhận nháp hoặc đã xuất bản', () => {
    expect(isPostStatus('draft')).toBe(true);
    expect(isPostStatus('published')).toBe(true);
    expect(isPostStatus('hidden')).toBe(false);
  });
});
