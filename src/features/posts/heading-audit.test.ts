import { describe, expect, it } from 'vitest';
import { auditHeadings } from './heading-audit';

function para(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}
function heading(level: 2 | 3, text: string) {
  return { type: 'heading', attrs: { level }, content: [{ type: 'text', text }] };
}
function longText(words: number) {
  return Array.from({ length: words }, () => 'từ').join(' ');
}

describe('heading-audit', () => {
  it('không cảnh báo khi doc rỗng hoặc bài ngắn không heading', () => {
    expect(auditHeadings(null).warnings).toEqual([]);
    expect(auditHeadings({ type: 'doc', content: [para('ngắn gọn')] }).warnings).toEqual([]);
  });

  it('cảnh báo khi bài dài mà không có H2', () => {
    const doc = { type: 'doc', content: [para(longText(400))] };
    const { warnings } = auditHeadings(doc);
    expect(warnings.some((w) => w.includes('chưa có Tiêu đề 2'))).toBe(true);
  });

  it('không cảnh báo thiếu H2 khi bài dài đã có H2', () => {
    const doc = { type: 'doc', content: [heading(2, 'Mục'), para(longText(400))] };
    expect(auditHeadings(doc).warnings).toEqual([]);
  });

  it('cảnh báo khi H3 xuất hiện trước H2 đầu tiên', () => {
    const doc = { type: 'doc', content: [heading(3, 'Con'), para(longText(400)), heading(2, 'Cha')] };
    const { warnings } = auditHeadings(doc);
    expect(warnings.some((w) => w.includes('Tiêu đề 3 trước Tiêu đề 2'))).toBe(true);
  });

  it('không cảnh báo nhảy cóc khi H2 đứng trước H3', () => {
    const doc = { type: 'doc', content: [heading(2, 'Cha'), heading(3, 'Con'), para(longText(400))] };
    expect(auditHeadings(doc).warnings).toEqual([]);
  });

  it('cảnh báo khi có tiêu đề trống', () => {
    const doc = { type: 'doc', content: [heading(2, '   '), para('nội dung ngắn')] };
    const { warnings } = auditHeadings(doc);
    expect(warnings.some((w) => w.includes('tiêu đề trống'))).toBe(true);
  });
});
