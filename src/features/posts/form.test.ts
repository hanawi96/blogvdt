import { describe, expect, it } from 'vitest';
import { excerptFieldValue, expectedRevision, parsePostForm, staleRevision } from './form';

function draftForm(excerpt: string, text = 'Đoạn mở đầu của bài viết.') {
  const form = new FormData();
  form.set('title', 'Bài');
  form.set('slug', 'bai');
  form.set('coverMediaId', '');
  form.set(
    'contentJson',
    JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    }),
  );
  form.set('seoTitle', '');
  form.set('metaDescription', '');
  form.set('excerpt', excerpt);
  form.set('status', 'draft');
  return form;
}

describe('tóm tắt bài viết', () => {
  it('để trống thì lấy đoạn đầu', () => {
    const parsed = parsePostForm(draftForm(''));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.input.excerpt).toBe('Đoạn mở đầu của bài viết.');
    expect(parsed.input.status).toBe('draft');
  });

  it('giữ tóm tắt tự gõ và không đóng băng đoạn tự sinh khi mở lại', () => {
    const parsed = parsePostForm(draftForm('Tóm tắt tay'));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.input.excerpt).toBe('Tóm tắt tay');
    const json = parsed.input.contentJson;
    expect(excerptFieldValue(parsed.input.excerpt, json)).toBe('Tóm tắt tay');
    expect(excerptFieldValue('Đoạn mở đầu của bài viết.', json)).toBe('');
  });

  it('khoảng trắng được xem như để trống', () => {
    const parsed = parsePostForm(draftForm('   '));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.input.excerpt).toBe('Đoạn mở đầu của bài viết.');
  });
});

describe('phiên bản lưu bài', () => {
  it('bỏ qua khi form chưa có mốc cập nhật', () => {
    const form = draftForm('');
    expect(expectedRevision(form)).toBeNull();
    expect(staleRevision(10, null)).toBe(false);
  });

  it('khớp đúng mốc và từ chối mốc cũ hoặc sai', () => {
    const form = draftForm('');
    form.set('updatedAt', '1700000000000');
    expect(expectedRevision(form)).toBe(1700000000000);
    expect(staleRevision(1700000000000, 1700000000000)).toBe(false);
    expect(staleRevision(1700000000001, 1700000000000)).toBe(true);
    form.set('updatedAt', '1.5');
    expect(expectedRevision(form)).toBeNull();
  });
});
