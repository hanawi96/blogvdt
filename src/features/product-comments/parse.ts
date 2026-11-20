export const COMMENT_NAME_MAX = 40;
export const COMMENT_BODY_MAX = 1000;
export const COMMENT_RATE_LIMIT = 5;
export const COMMENT_RATE_WINDOW_MS = 60 * 60 * 1000;
export const COMMENT_ADMIN_PAGE_SIZE = 20;
/** Nhãn badge cạnh tên admin khi trả lời công khai. */
export const SHOP_BADGE_LABEL = 'Chủ shop';

export type CommentStatus = 'pending' | 'approved' | 'hidden';
export type CommentAuthorKind = 'guest' | 'shop';

export function normalizeCommentName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, COMMENT_NAME_MAX);
}

/** Tên hiển thị khi admin trả lời — ưu tiên displayName phiên đăng nhập. */
export function shopReplyAuthorName(displayName: string): string {
  const name = normalizeCommentName(displayName);
  return name || 'Admin';
}

export function normalizeCommentBody(raw: string): string {
  return raw.replace(/\r\n/g, '\n').trim().slice(0, COMMENT_BODY_MAX);
}

/** Prefill trả lời: "@Hương " — bỏ @prefix cũ nếu đang sửa. */
export function replyMentionPrefix(authorName: string): string {
  const name = normalizeCommentName(authorName);
  if (!name) return '';
  return `@${name} `;
}

export function parseCommentStatus(raw: string | null | undefined): CommentStatus | 'all' {
  if (raw === 'pending' || raw === 'approved' || raw === 'hidden' || raw === 'all') return raw;
  return 'pending';
}

export function readCommentPage(raw: string | null | undefined): number {
  const page = Number(raw ?? '1');
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export function validateGuestComment(input: {
  authorName: string;
  body: string;
}): { ok: true; authorName: string; body: string } | { ok: false; error: string } {
  const authorName = normalizeCommentName(input.authorName);
  const body = normalizeCommentBody(input.body);
  if (!authorName) return { ok: false, error: 'Nhập tên hiển thị.' };
  if (authorName.length < 2) return { ok: false, error: 'Tên hiển thị cần ít nhất 2 ký tự.' };
  if (!body) return { ok: false, error: 'Nhập nội dung bình luận.' };
  if (body.length < 2) return { ok: false, error: 'Nội dung quá ngắn.' };
  return { ok: true, authorName, body };
}
