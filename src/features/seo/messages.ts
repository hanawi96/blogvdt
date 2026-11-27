/** Catalog thông báo SEO health — một nguồn cho detail issue và lead UI. */

import type { HeadingIssueCode } from '../posts/heading-audit';

export const HEALTH_LOAD_ERROR = 'Không tải được kết quả kiểm tra.';
export const HEALTH_RUN_ERROR = 'Mất kết nối khi kiểm tra. Kết quả đã lưu vẫn giữ nguyên.';

/** Copy checklist/health cho cấu trúc heading — đồng bộ editor SeoChecklist. */
export const HEADING_ISSUE_DETAIL: Record<HeadingIssueCode, string> = {
  'empty-heading': 'Có tiêu đề trống.',
  'jump-before-h2': 'Tiêu đề 3 nên đứng sau một tiêu đề 2.',
  'long-without-h2': 'Bài dài nên chia bằng tiêu đề 2.',
};

export const HEALTH_SITE_TITLE = 'Toàn site';
export const HEALTH_COVER_LABEL = 'ảnh đại diện';
export const HEALTH_CONTENT_IMAGE_FALLBACK = 'ảnh trong bài';

/** Copy UI trang /admin/seo — overview và ưu tiên sửa. */
export const HEALTH_PRIORITY_LIMIT = 5;

export const HEALTH_UI = {
  scoreLabel: 'Điểm sức khỏe',
  scoreProvisional: 'Đang chạy — điểm tạm trên phần đã xác minh.',
  cleanLabel: 'Không lỗi',
  errorsLabel: 'Lỗi nghiêm trọng',
  warningsLabel: 'Cảnh báo',
  pendingLabel: 'Chưa xác minh',
  priorityHeading: 'Ưu tiên sửa',
  priorityHint: 'Bấm một loại để lọc danh sách bên dưới. Sắp theo số lỗi nghiêm trọng.',
  priorityMore: (count: number) => `Còn ${count} loại khác — chọn trong bộ lọc Loại.`,
  priorityClear: 'Bỏ lọc loại lỗi',
  filterSeverity: 'Mức',
  filterCode: 'Loại',
  filterPost: 'Bài viết',
  filterAllSeverity: 'Mọi mức',
  filterAllCode: 'Mọi loại',
  filterAllPost: 'Mọi bài',
  filterSubmit: 'Lọc',
  filterReset: 'Bỏ lọc',
  issuesHeading: 'Danh sách cần sửa',
  issuesEmptyFiltered: 'Không có mục khớp bộ lọc hiện tại.',
  issuesEmptyDone: 'Không có lỗi hoặc cảnh báo trên các bài đã xác minh.',
  issuesEmptyProgress: 'Chưa thấy vấn đề trên phần đã kiểm tra. Bấm Tiếp tục nếu còn bài chưa xong.',
  uncheckedHeading: 'Chưa kiểm tra',
  staleHeading: 'Đã sửa sau lần kiểm tra',
  morePosts: (count: number) => `Còn ${count} bài khác.`,
  emptyTitle: 'Chưa kiểm tra SEO lần nào',
  emptyBodyPublished: (count: number) =>
    `Có ${count} bài đã xuất bản đang chờ xác minh. Chạy kiểm tra để rà toàn bộ và chấm điểm sức khỏe.`,
  emptyBodyNone: 'Chạy kiểm tra để rà SEO toàn site. Khi có bài xuất bản, công cụ sẽ chỉ ra chỗ cần sửa.',
  emptyStart: 'Chạy kiểm tra ngay',
  emptyPoints: [
    'Rà tiêu đề, mô tả, độ dài meta, nội dung mỏng và cấu trúc heading.',
    'Kiểm tra ảnh đại diện, file ảnh trên kho, ALT và liên kết nội bộ.',
    'Chấm điểm sức khỏe và xếp ưu tiên sửa theo loại lỗi.',
  ],
  colPost: 'Bài viết',
  colLevel: 'Mức',
  colCode: 'Loại',
  colDetail: 'Nguyên nhân',
  colFix: 'Sửa',
  levelError: 'Lỗi',
  levelWarning: 'Cảnh báo',
  fixAction: 'Sửa',
} as const;

/** Câu trùng meta — dùng chung editor checklist và health. */
export const META_DUPLICATE = {
  titleEqualsDescription: 'Tiêu đề và mô tả đang giống nhau.',
  titleTaken: 'Tiêu đề này đã được dùng ở một trang khác.',
  descriptionTaken: 'Mô tả này đã được dùng ở một trang khác.',
} as const;

export const HEALTH_ISSUE = {
  siteOriginMissing: 'Chưa có địa chỉ website hợp lệ nên canonical và sitemap không tạo được.',
  siteFilesOffline: 'Chưa kết nối được kho ảnh. File trên kho chưa được xác minh.',
  titleEmpty: 'SEO title và tiêu đề bài đều trống.',
  descriptionEmpty: 'Mô tả SEO và tóm tắt đều trống. Trang đang dùng câu dự phòng.',
  contentEmpty: 'Bài chưa có nội dung.',
  coverMissing: 'Nên thêm ảnh đại diện.',
  slugInvalid: 'Slug không đúng định dạng nên không có URL công khai.',
  slugBlocked: 'Slug đang trùng một redirect đã lưu.',
  sitemapMissing: 'Bài đã xuất bản nhưng sitemap không có URL này.',
  canonicalMissing: 'Canonical không tạo được từ URL công khai.',
  contentUnreadable: 'Nội dung bài không đọc được nên ảnh và liên kết trong bài chưa được kiểm tra.',
  imageHeadFailed: 'Không kết nối được kho ảnh để xác minh file.',
  imageUnchecked: 'Còn file ảnh chưa xác minh trong lượt này.',
  imageTruncated: 'Chỉ kiểm tra 30 ảnh đầu trong bài.',
  linkSelf: 'Liên kết trỏ về chính bài này.',
  linkTruncated: 'Chỉ kiểm tra 20 liên kết đầu.',
  inboundBase:
    'Chưa thấy bài viết đã xuất bản nào trỏ tới. Không cần thêm liên kết nếu chưa có bài phù hợp.',
  inboundTruncatedSuffix: 'Một số bài có hơn 20 liên kết nên kết quả có thể thiếu.',
} as const;

export function healthThinContentDetail(words: number): string {
  return `Bài hơi ngắn (${words} từ). Nên viết thêm để đủ sâu cho SEO.`;
}

export function healthBrokenImagesDetail(labels: readonly string[]): string {
  return `Ảnh không còn dùng được: ${labels.slice(0, 3).join(', ')}.`;
}

export function healthEmptyAltDetail(labels: readonly string[]): string {
  return `${labels.slice(0, 3).join(', ')} đang trống ALT. Ảnh trang trí được phép; ảnh chứa thông tin cần mô tả đúng nội dung.`;
}

export function healthLinkMissingDetail(paths: string): string {
  return `Liên kết không có bài: ${paths}.`;
}

export function healthLinkUnpublishedDetail(paths: string): string {
  return `Liên kết trỏ tới bài chưa xuất bản: ${paths}.`;
}

export function healthLinkRedirectDetail(text: string): string {
  return `Liên kết đang đi qua đường dẫn cũ: ${text}.`;
}

export function healthInboundDetail(truncated: boolean): string {
  return truncated
    ? `${HEALTH_ISSUE.inboundBase} ${HEALTH_ISSUE.inboundTruncatedSuffix}`
    : HEALTH_ISSUE.inboundBase;
}

export function healthNoteNever(): string {
  return 'Chưa kiểm tra lần nào. Các bài xuất bản đang chưa được xác minh.';
}

export function healthNoteInProgress(whenLabel: string, verified: number, unchecked: number): string {
  return `Đang kiểm tra (bắt đầu ${whenLabel}). Đã xác minh ${verified}/${verified + unchecked} bài. Bấm Tiếp tục nếu chưa xong — số liệu bên dưới chỉ gồm phần đã xác minh.`;
}

export function healthNoteDoneEmpty(whenLabel: string): string {
  return `Kiểm tra xong lúc ${whenLabel}. Không có bài xuất bản để kiểm tra.`;
}

export function healthNoteDone(input: {
  whenLabel: string;
  verified: number;
  unchecked: number;
  stale: number;
}): string {
  const parts = [`Xong lúc ${input.whenLabel}. Đã xác minh ${input.verified} bài.`];
  if (input.unchecked > 0) parts.push(`Còn ${input.unchecked} bài chưa nằm trong lần này — chạy lại để đủ.`);
  if (input.stale > 0) parts.push(`${input.stale} bài đã sửa sau lần kiểm tra — nên xác minh lại.`);
  if (input.unchecked === 0 && input.stale === 0) {
    parts.push('Ưu tiên sửa các lỗi nghiêm trọng trước, rồi đến cảnh báo.');
  }
  return parts.join(' ');
}
