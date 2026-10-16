/** Nguồn chung kiểm tra cấu trúc heading cho cả editor và box Kiểm tra SEO — hàm thuần, không I/O. */

import { countWords } from './reading-stats';

type JsonNode = {
  type?: string;
  text?: string;
  attrs?: { level?: unknown };
  content?: JsonNode[];
};

export type HeadingInfo = { level: 2 | 3; text: string };

/** Bài đạt ngưỡng "dài" (nên có heading để chia mục) khi vượt số từ này. */
export const LONG_POST_WORDS = 300;

/** Mã vấn đề cấu trúc heading — mỗi nơi tự chọn câu chữ hiển thị phù hợp ngữ cảnh. */
export type HeadingIssueCode = 'empty-heading' | 'jump-before-h2' | 'long-without-h2';

/**
 * Quy tắc heading dùng chung. `words` là tổng số từ của nội dung.
 * Thứ tự ưu tiên: tiêu đề trống → nhảy cóc H3 trước H2 → bài dài thiếu H2.
 */
export function headingStructureIssues(headings: readonly HeadingInfo[], words: number): HeadingIssueCode[] {
  const issues: HeadingIssueCode[] = [];
  if (headings.some((heading) => heading.text.trim().length === 0)) issues.push('empty-heading');
  if (jumpsBeforeFirstH2(headings)) issues.push('jump-before-h2');
  if (words >= LONG_POST_WORDS && !headings.some((heading) => heading.level === 2)) issues.push('long-without-h2');
  return issues;
}

export type HeadingAudit = {
  /** Cảnh báo ngắn để hiển thị; rỗng khi cấu trúc ổn. */
  warnings: string[];
};

/** Câu chữ cho trình soạn thảo (gợi ý trực tiếp khi viết). */
const EDITOR_MESSAGES: Record<HeadingIssueCode, string> = {
  'empty-heading': 'Có tiêu đề trống — xóa hoặc thêm nội dung cho heading.',
  'jump-before-h2': 'Có Tiêu đề 3 trước Tiêu đề 2 — nên bắt đầu bằng Tiêu đề 2.',
  'long-without-h2': 'Bài dài nhưng chưa có Tiêu đề 2 — thêm heading giúp đọc và SEO tốt hơn.',
};

export function auditHeadings(doc: JsonNode | null | undefined): HeadingAudit {
  if (!doc) return { warnings: [] };
  const headings: HeadingInfo[] = [];
  let text = '';
  walk(doc, headings, (value) => {
    text += value;
  });
  const issues = headingStructureIssues(headings, countWords(text));
  return { warnings: issues.map((code) => EDITOR_MESSAGES[code]) };
}

function jumpsBeforeFirstH2(headings: readonly HeadingInfo[]): boolean {
  for (const heading of headings) {
    if (heading.level === 2) return false;
    if (heading.level === 3) return true;
  }
  return false;
}

function walk(node: JsonNode, headings: HeadingInfo[], addText: (value: string) => void): void {
  if (node.type === 'heading') {
    headings.push({ level: node.attrs?.level === 3 ? 3 : 2, text: headingText(node) });
  }
  if (typeof node.text === 'string') addText(` ${node.text}`);
  for (const child of node.content ?? []) walk(child, headings, addText);
}

function headingText(node: JsonNode): string {
  const own = node.text ?? '';
  const children = (node.content ?? []).map(headingText).join('');
  return `${own}${children}`.replace(/\s+/g, ' ').trim();
}
