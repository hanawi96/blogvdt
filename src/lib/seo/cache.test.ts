import { describe, expect, it } from 'vitest';
import { blogReadStatus } from './cache';

describe('trạng thái trang blog', () => {
  it('lỗi database là 503, không phải 404', () => {
    expect(blogReadStatus({ hasSite: false, failed: true })).toBe(503);
    expect(blogReadStatus({ hasSite: false, failed: false })).toBe(503);
    expect(blogReadStatus({ hasSite: true, failed: true, notFound: true })).toBe(503);
  });

  it('thiếu bài hoặc danh mục là 404 khi database vẫn đọc được', () => {
    expect(blogReadStatus({ hasSite: true, notFound: true })).toBe(404);
    expect(blogReadStatus({ hasSite: true })).toBe(200);
  });
});
