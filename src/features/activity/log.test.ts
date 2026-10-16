import { describe, expect, it } from 'vitest';
import { describeUserChange, EMPTY_PROFILE } from '../auth/users';
import {
  ACTIVITY_PAGE_SIZE,
  AUTOSAVE_LOG_WINDOW_MS,
  activityText,
  actorLabel,
  pageWindow,
  postChanged,
  postLogAction,
  postSummary,
  readActivityFilters,
  withinLogWindow,
  type PostComparable,
} from './log';

const post: PostComparable = {
  title: 'Bài mẫu',
  slug: 'bai-mau',
  categoryIds: [1],
  tagIds: [],
  coverMediaId: null,
  contentJson: '{"type":"doc"}',
  excerpt: 'Tóm tắt',
  seoTitle: null,
  metaDescription: '',
  status: 'draft',
};

describe('nhật ký', () => {
  it('không ghi khi bài không đổi, và phân biệt xuất bản với gỡ bài', () => {
    expect(postChanged(post, post)).toBe(false);
    expect(postLogAction('draft', 'draft', false)).toBeNull();
    expect(postLogAction('draft', 'draft', true)).toBe('post.update');
    expect(postLogAction('draft', 'published', true)).toBe('post.publish');
    expect(postLogAction('published', 'draft', true)).toBe('post.unpublish');
    expect(postSummary('post.publish', '  Bài\nA  ')).toBe('Đã xuất bản “Bài A”.');
    expect(postSummary('post.trash', 'Bài A')).toBe('Đã chuyển “Bài A” vào thùng rác.');
    expect(postSummary('post.restore', 'Bài A')).toBe('Đã khôi phục “Bài A” thành bản nháp.');
    expect(postSummary('post.delete', 'Bài A')).toBe('Đã xóa vĩnh viễn “Bài A”.');
  });

  it('gom autosave trong 10 phút và tách sau mốc đó', () => {
    const start = 1_000_000;
    expect(withinLogWindow(start, start + AUTOSAVE_LOG_WINDOW_MS - 1)).toBe(true);
    expect(withinLogWindow(start, start + AUTOSAVE_LOG_WINDOW_MS)).toBe(false);
    expect(withinLogWindow(start, start - 1)).toBe(false);
  });

  it('tên hiển thị không rơi về email khi để trống', () => {
    expect(actorLabel('  ', 4)).toBe('Tài khoản #4');
    expect(actorLabel('Yên', 1)).toBe('Yên');
    expect(activityText('mật khẩu\nsecret', 20)).toBe('mật khẩu secret');
  });

  it('bỏ qua thay đổi tài khoản không có khác biệt và mô tả khóa quyền', () => {
    const current = { displayName: 'An', email: 'an@example.com', role: 'editor' as const, status: 'active' as const, ...EMPTY_PROFILE };
    expect(describeUserChange(current, { ...current, email: 'an@example.com' })).toBeNull();
    expect(describeUserChange(current, { ...current, status: 'disabled' })?.action).toBe('user.disable');
    expect(describeUserChange(current, { ...current, role: 'admin' })?.summary).toMatch(/Quản trị/);
    expect(describeUserChange({ ...current, status: 'disabled' }, { ...current, status: 'active' })?.summary).toMatch(/mở khóa/);
  });

  it('phân trang 20 dòng và bỏ query không hợp lệ', () => {
    expect(ACTIVITY_PAGE_SIZE).toBe(20);
    expect(pageWindow(0, 1)).toEqual({ current: 1, pageCount: 1, offset: 0 });
    expect(pageWindow(21, 2)).toEqual({ current: 2, pageCount: 2, offset: 20 });
    expect(pageWindow(20, 9)).toEqual({ current: 1, pageCount: 1, offset: 0 });
    const filters = readActivityFilters(new URLSearchParams('user=0&action=drop&from=2026-10-01&to=2026-09-01&page=3'));
    expect(filters.actorId).toBeNull();
    expect(filters.action).toBe('');
    expect(filters.from).toBe('2026-10-01');
    expect(filters.page).toBe(3);
  });
});
