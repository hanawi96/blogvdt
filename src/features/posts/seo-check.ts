import { isInternalHref } from './links';
import { SLUG_PATTERN } from './slug';

export const SEO_TITLE_RANGE = { min: 30, max: 60 };
export const SEO_DESC_RANGE = { min: 70, max: 160 };

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
    coverItem(input.hasCover),
    imageItem(content, input.hasCover, input.coverAlt.trim()),
    headingItem(content),
    linkItem(content),
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
  if (content.text.trim().length === 0) return item('content', 'Nội dung', 'Bài chưa có nội dung.', 'error', '.ProseMirror');
  return item('content', 'Nội dung', 'Đã có nội dung.', 'pass', '');
}

function seoTitleItem(title: string, seoTitle: string, headline: string): SeoCheck {
  if (!title && !seoTitle) return item('seo-title', 'SEO title', 'Cần có tiêu đề trước.', 'na', '');
  const note = lengthNote(headline.length, SEO_TITLE_RANGE.min, SEO_TITLE_RANGE.max);
  const target = seoTitle ? '[name="seoTitle"]' : '#post-title';
  if (note) return item('seo-title', 'SEO title', note, 'improve', target);
  if (!seoTitle) return item('seo-title', 'SEO title', 'Đang dùng tiêu đề bài viết.', 'pass', '');
  return item('seo-title', 'SEO title', 'Độ dài nằm trong mức tham khảo.', 'pass', '');
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
  if (missingContentAlt) return item('alt', 'Mô tả ảnh', 'Có ảnh trong bài chưa có mô tả.', 'improve', '.ProseMirror');
  if (missingCoverAlt) return item('alt', 'Mô tả ảnh', 'Ảnh đại diện chưa có mô tả.', 'improve', '[data-cover-alt]');
  return item('alt', 'Mô tả ảnh', 'Ảnh đã có mô tả.', 'pass', '');
}

function headingItem(content: ContentFacts | null): SeoCheck {
  if (!content || content.text.trim().length === 0) {
    return item('headings', 'Tiêu đề trong bài', 'Chưa có nội dung để kiểm tra.', 'na', '');
  }
  const issue = headingIssue(content);
  if (issue) return item('headings', 'Tiêu đề trong bài', issue, 'improve', '.ProseMirror');
  return item('headings', 'Tiêu đề trong bài', 'Cấu trúc tiêu đề ổn.', 'pass', '');
}

function linkItem(content: ContentFacts | null): SeoCheck {
  if (!content || content.text.trim().length === 0) {
    return item('links', 'Liên kết nội bộ', 'Chưa có nội dung để kiểm tra.', 'na', '');
  }
  if (content.internal === 0) {
    return item('links', 'Liên kết nội bộ', 'Nên thêm liên kết tới một bài hoặc sản phẩm trên website.', 'improve', '.ProseMirror');
  }
  return item('links', 'Liên kết nội bộ', 'Đã có liên kết nội bộ.', 'pass', '');
}

function authorItem(siteName: string, publishedAt: number | null): SeoCheck {
  if (!siteName) return item('author', 'Tác giả và ngày đăng', 'Website chưa có tên để làm tác giả.', 'improve', '');
  if (publishedAt) return item('author', 'Tác giả và ngày đăng', 'Có tên website và ngày xuất bản.', 'pass', '');
  return item('author', 'Tác giả và ngày đăng', 'Tên website là tác giả. Ngày đăng có khi xuất bản.', 'pass', '');
}

function headingIssue(content: ContentFacts): string | null {
  if (content.headings.some((heading) => heading.text.length === 0)) return 'Có tiêu đề trống.';
  const firstH2 = content.headings.findIndex((heading) => heading.level === 2);
  const firstH3 = content.headings.findIndex((heading) => heading.level === 3);
  if (firstH3 !== -1 && (firstH2 === -1 || firstH3 < firstH2)) return 'Tiêu đề 3 nên đứng sau một tiêu đề 2.';
  if (content.text.trim().length >= 400 && firstH2 === -1) return 'Bài dài nên chia bằng tiêu đề 2.';
  return null;
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
