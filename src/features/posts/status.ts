export const POST_STATUSES = ['draft', 'published'] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const POST_STATUS_LABELS: Record<PostStatus, string> = {
  draft: 'Bản nháp',
  published: 'Đã xuất bản',
};

export function isPostStatus(value: string): value is PostStatus {
  return POST_STATUSES.some((status) => status === value);
}
