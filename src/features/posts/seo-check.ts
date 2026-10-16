import { plainMetaText, type MetaCorpus } from '../../lib/seo/meta';
import { headingStructureIssues, type HeadingIssueCode } from './heading-audit';
import { isInternalHref, type PostLinkIssue } from './links';
import { countWords } from './reading-stats';
import { SLUG_PATTERN } from './slug';

export const SEO_TITLE_RANGE = { min: 30, max: 60 };
export const SEO_DESC_RANGE = { min: 70, max: 160 };
/** Dưới mức này coi là bài mỏng, gợi ý viết thêm (không chặn). */
export const MIN_CONTENT_WORDS = 150;

export type SeoCheckState = 'pass' | 'improve' | 'error' | 'na';
export type SlugCheck = 'empty' | 'invalid' | 'checking' | 'taken' | 'free';

export type SeoCheck = {
  id: string;
  label: string;
  detail: string;
  state: SeoCheckState;
  target: string;
};

export type SeoCheckInput = {
  title: string;
  slug: string;
  slugCheck: SlugCheck;
  seoTitle: string;
  metaDescription: string;
  excerpt: string;
  contentJson: string;
  hasCover: boolean;
  coverAlt: string;
  publishedAt: number | null;
  siteName: string;
  host: string;
  corpus?: MetaCorpus;
  linkIssues?: PostLinkIssue[];
  linkTruncated?: boolean;
  checkingLinks?: boolean;
  inbound?: boolean | null;
  published?: boolean;
};

type JsonNode = {
  type?: string;
  text?: string;
  attrs?: { level?: unknown; alt?: unknown };
  content?: JsonNode[];
  marks?: { type?: string; attrs?: { href?: unknown } }[];
};

export function lengthNote(length: number, min: number, max: number): string {
  if (length === 0) return '';
  if (length < min) return `Hơi ngắn. Mức tham khảo khoảng ${min}–${max} ký tự.`;
  if (length > max) return `Hơi dài. Mức tham khảo khoảng ${min}–${max} ký tự.`;
  return '';
}

export type SeoCheckSummary = { error: number; improve: number; pass: number; na: number };

const STATE_ORDER: Record<SeoCheckState, number> = { error: 0, improve: 1, pass: 2, na: 3 };

/** Đưa mục cần sửa/cải thiện lên trên, giữ thứ tự gốc trong cùng mức. Không đột biến mảng vào. */
export function orderSeoChecks(checks: readonly SeoCheck[]): SeoCheck[] {
  return checks
    .map((check, index) => ({ check, index }))
    .sort((a, b) => STATE_ORDER[a.check.state] - STATE_ORDER[b.check.state] || a.index - b.index)
    .map((entry) => entry.check);
}

export function summarizeSeoChecks(checks: readonly SeoCheck[]): SeoCheckSummary {
  const summary: SeoCheckSummary = { error: 0, improve: 0, pass: 0, na: 0 };
  for (const check of checks) summary[check.state] += 1;
  return summary;
}

export function checkPostSeo(input: SeoCheckInput): SeoCheck[] {
  const content = readContent(input.contentJson, input.host);
  const title = input.title.trim();
  const seoTitle = input.seoTitle.trim();
  const headline = seoTitle || title;
  const description = input.metaDescription.trim() || input.excerpt.trim();
  return [
    titleItem(title),
    slugItem(input.slugCheck),
    contentItem(content),
    seoTitleItem(title, seoTitle, headline),
    descriptionItem(description),
    duplicateItem(headline, description, input.corpus),
    coverItem(input.hasCover),
    imageItem(content, input.hasCover, input.coverAlt.trim()),
    headingItem(content),
    linkItem(content, input),
    inboundItem(input),
    authorItem(input.siteName.trim(), input.publishedAt),
  ];
}

function titleItem(title: string): SeoCheck {
  if (!title) return item('title', 'Tiêu đề', 'Nhập tiêu đề bài viết.', 'error', '#post-title');
  return item('title', 'Tiêu đề', 'Đã có tiêu đề.', 'pass', '');
}

function slugItem(slugCheck: SlugCheck): SeoCheck {
  if (slugCheck === 'empty') return item('slug', 'Slug', 'Nhập đường dẫn.', 'error', '[name="slug"]');
  if (slugCheck === 'invalid') return item('slug', 'Slug', 'Slug chỉ gồm chữ thường, số và dấu gạch.', 'error', '[name="slug"]');
  if (slugCheck === 'checking') return item('slug', 'Slug', 'Đang kiểm tra slug trùng.', 'na', '');
  if (slugCheck === 'taken') return item('slug', 'Slug', 'Slug đã được dùng.', 'error', '[name="slug"]');
  return item('slug', 'Slug', 'Slug hợp lệ và chưa trùng.', 'pass', '');
}

function contentItem(content: ContentFacts | null): SeoCheck {
  if (!content) return item('content', 'Nội dung', 'Nội dung bài viết không đọc được.', 'error', '.ProseMirror');
  const words = countWords(content.text);
  if (words === 0) return item('content', 'Nội dung', 'Bài chưa có nội dung.', 'error', '.ProseMirror');
  if (words < MIN_CONTENT_WORDS) {
    return item('content', 'Nội dung', `Bài hơi ngắn (${words} từ). Nên viết thêm để đủ sâu cho SEO.`, 'improve', '.ProseMirror');
  }
  return item('content', 'Nội dung', `Đã có nội dung (${words} từ).`, 'pass', '');
}

function seoTitleItem(title: string, seoTitle: string, headline: string): SeoCheck {
  if (!title && !seoTitle) return item('seo-title', 'SEO title', 'Cần có tiêu đề trước.', 'na', '');
  const note = lengthNote(headline.length, SEO_TITLE_RANGE.min, SEO_TITLE_RANGE.max);
  const target = seoTitle ? '[name="seoTitle"]' : '#post-title';
  if (note) return item('seo-title', 'SEO title', note, 'improve', target);
  if (!seoTitle) return item('seo-title', 'SEO title', 'Đang dùng tiêu đề bài viết.', 'pass', '');
  return item('seo-title', 'SEO title', 'Độ dài nằm trong mức tham khảo.', 'pass', '');
}

export function metaDuplicateNote(headline: string, description: string, corpus?: MetaCorpus): string {
  const title = plainMetaText(headline);
  const desc = plainMetaText(description);
  if (title && desc && title.toLocaleLowerCase('vi') === desc.toLocaleLowerCase('vi')) return 'Tiêu đề và mô tả đang giống nhau.';
  const titleKey = title.toLocaleLowerCase('vi');
  const descKey = desc.toLocaleLowerCase('vi');
  if (titleKey && (corpus?.titles ?? []).some((item) => plainMetaText(item).toLocaleLowerCase('vi') === titleKey)) {
    return 'Tiêu đề này đã được dùng ở một trang khác.';
  }
  if (descKey && (corpus?.descriptions ?? []).some((item) => plainMetaText(item).toLocaleLowerCase('vi') === descKey)) {
    return 'Mô tả này đã được dùng ở một trang khác.';
  }
  return '';
}

function duplicateItem(headline: string, description: string, corpus?: MetaCorpus): SeoCheck {
  if (!plainMetaText(headline) && !plainMetaText(description)) {
    return item('duplicate', 'Trùng lặp', 'Chưa có tiêu đề hoặc mô tả để so sánh.', 'na', '');
  }
  const note = metaDuplicateNote(headline, description, corpus);
  if (!note) return item('duplicate', 'Trùng lặp', 'Không trùng tiêu đề hoặc mô tả đã có.', 'pass', '');
  const target = note.startsWith('Mô tả') || note.startsWith('Tiêu đề và mô tả') ? '[name="metaDescription"]' : '[name="seoTitle"]';
  return item('duplicate', 'Trùng lặp', note, 'improve', target);
}

function descriptionItem(description: string): SeoCheck {
  if (!description) {
    return item('description', 'Mô tả', 'Thêm mô tả SEO hoặc tóm tắt.', 'improve', '[name="metaDescription"]');
  }
  const note = lengthNote(description.length, SEO_DESC_RANGE.min, SEO_DESC_RANGE.max);
  if (note) return item('description', 'Mô tả', note, 'improve', '[name="metaDescription"]');
  return item('description', 'Mô tả', 'Đã có mô tả trong mức tham khảo.', 'pass', '');
}

function coverItem(hasCover: boolean): SeoCheck {
  if (!hasCover) return item('cover', 'Ảnh đại diện', 'Nên thêm ảnh đại diện.', 'improve', '.cover-drop');
  return item('cover', 'Ảnh đại diện', 'Đã có ảnh đại diện.', 'pass', '');
}

function imageItem(content: ContentFacts | null, hasCover: boolean, coverAlt: string): SeoCheck {
  const missingContentAlt = content?.images.some((alt) => alt.length === 0) ?? false;
  const missingCoverAlt = hasCover && coverAlt.length === 0;
  if (!content || (content.images.length === 0 && !hasCover)) {
    return item('alt', 'Mô tả ảnh', 'Chưa có ảnh để kiểm tra.', 'na', '');
  }
  if (missingContentAlt || missingCoverAlt) {
    return item('alt', 'Mô tả ảnh', 'Mô tả trống được giữ cho ảnh trang trí. Ảnh chứa thông tin nên mô tả đúng nội dung nhìn thấy.', 'pass', '');
  }
  return item('alt', 'Mô tả ảnh', 'Ảnh đã có mô tả.', 'pass', '');
}

const HEADING_CHECK_MESSAGES: Record<HeadingIssueCode, string> = {
  'empty-heading': 'Có tiêu đề trống.',
  'jump-before-h2': 'Tiêu đề 3 nên đứng sau một tiêu đề 2.',
  'long-without-h2': 'Bài dài nên chia bằng tiêu đề 2.',
};

function headingItem(content: ContentFacts | null): SeoCheck {
  if (!content || content.text.trim().length === 0) {
    return item('headings', 'Tiêu đề trong bài', 'Chưa có nội dung để kiểm tra.', 'na', '');
  }
  const issues = headingStructureIssues(content.headings, countWords(content.text));
  if (issues.length > 0) return item('headings', 'Tiêu đề trong bài', HEADING_CHECK_MESSAGES[issues[0]!], 'improve', '.ProseMirror');
  return item('headings', 'Tiêu đề trong bài', 'Cấu trúc tiêu đề ổn.', 'pass', '');
}

function linkItem(content: ContentFacts | null, input: SeoCheckInput): SeoCheck {
  if (!content || content.text.trim().length === 0) {
    return item('links', 'Liên kết nội bộ', 'Chưa có nội dung để kiểm tra.', 'na', '');
  }
  const issues = input.linkIssues ?? [];
  if (issues.length > 0) {
    const notes = issues.slice(0, 3).map(linkNote);
    if (issues.length > 3) notes.push('Còn liên kết khác cần xem.');
    if (input.linkTruncated) notes.push('Chỉ kiểm tra 20 liên kết đầu.');
    return item('links', 'Liên kết nội bộ', notes.join(' '), 'improve', '.ProseMirror');
  }
  if (input.checkingLinks) return item('links', 'Liên kết nội bộ', 'Đang kiểm tra liên kết.', 'na', '');
  if (content.internal === 0) {
    return item('links', 'Liên kết nội bộ', 'Chưa có liên kết nội bộ. Chỉ thêm khi bài khác thật sự liên quan.', 'pass', '');
  }
  return item('links', 'Liên kết nội bộ', 'Không có liên kết bài viết nào bị hỏng.', 'pass', '');
}

function inboundItem(input: SeoCheckInput): SeoCheck {
  if (!input.published) return item('inbound', 'Bài trỏ tới', 'Chỉ kiểm tra khi bài đã xuất bản.', 'na', '');
  if (input.inbound === null || input.inbound === undefined) return item('inbound', 'Bài trỏ tới', 'Đang kiểm tra bài khác có trỏ tới không.', 'na', '');
  if (input.inbound) return item('inbound', 'Bài trỏ tới', 'Đã có bài khác trỏ tới bài này.', 'pass', '');
  return item('inbound', 'Bài trỏ tới', 'Chưa có bài khác trỏ tới. Không cần thêm liên kết nếu chưa có bài phù hợp.', 'pass', '');
}

function linkNote(issue: PostLinkIssue): string {
  if (issue.kind === 'redirect' && issue.official) return `${issue.path} là đường dẫn cũ. URL chính là ${issue.official}.`;
  if (issue.kind === 'unpublished') return `${issue.path} không còn là bài đã xuất bản.`;
  if (issue.kind === 'self') return `${issue.path} đang trỏ về chính bài này.`;
  return `${issue.path} không có bài tương ứng.`;
}

function authorItem(siteName: string, publishedAt: number | null): SeoCheck {
  if (!siteName) return item('author', 'Tác giả và ngày đăng', 'Website chưa có tên để làm tác giả.', 'improve', '');
  if (publishedAt) return item('author', 'Tác giả và ngày đăng', 'Có tên website và ngày xuất bản.', 'pass', '');
  return item('author', 'Tác giả và ngày đăng', 'Tên website là tác giả. Ngày đăng có khi xuất bản.', 'pass', '');
}

type ContentFacts = {
  text: string;
  headings: { level: 2 | 3; text: string }[];
  images: string[];
  internal: number;
};

function readContent(raw: string, host: string): ContentFacts | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || (parsed as { type?: unknown }).type !== 'doc') return null;
  const facts: ContentFacts = { text: '', headings: [], images: [], internal: 0 };
  walk(parsed as JsonNode, facts, host);
  return facts;
}

function walk(node: JsonNode, facts: ContentFacts, host: string): void {
  if (node.type === 'text') {
    facts.text += node.text ?? '';
    for (const mark of node.marks ?? []) {
      const href = mark.attrs?.href;
      if (mark.type === 'link' && typeof href === 'string' && isInternalHref(href, host)) facts.internal += 1;
    }
  }
  if (node.type === 'heading') {
    facts.headings.push({ level: node.attrs?.level === 3 ? 3 : 2, text: textOf(node) });
  }
  if (node.type === 'image') {
    facts.images.push(typeof node.attrs?.alt === 'string' ? node.attrs.alt.trim() : '');
  }
  for (const child of node.content ?? []) walk(child, facts, host);
}

function textOf(node: JsonNode): string {
  const own = node.text ?? '';
  const children = (node.content ?? []).map(textOf).join('');
  return `${own}${children}`.replace(/\s+/g, ' ').trim();
}

function item(id: string, label: string, detail: string, state: SeoCheckState, target: string): SeoCheck {
  return { id, label, detail, state, target };
}

export function slugCheckState(slug: string, taken: boolean | null): SlugCheck {
  const value = slug.trim();
  if (!value) return 'empty';
  if (!SLUG_PATTERN.test(value)) return 'invalid';
  if (taken === null) return 'checking';
  return taken ? 'taken' : 'free';
}
