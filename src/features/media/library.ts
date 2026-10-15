export const MEDIA_PAGE_SIZE = 24;

export type MediaUsageFilter = 'all' | 'used' | 'unused';
export type MediaSort = 'newest' | 'name' | 'size';

export type MediaLibraryQuery = {
  q: string;
  usage: MediaUsageFilter;
  sort: MediaSort;
  page: number;
};

export function parseMediaLibraryQuery(params: URLSearchParams): MediaLibraryQuery {
  const usageRaw = params.get('usage');
  const sortRaw = params.get('sort');
  const page = Number(params.get('page'));
  return {
    q: (params.get('q') ?? '').trim().slice(0, 80),
    usage: usageRaw === 'used' || usageRaw === 'unused' ? usageRaw : 'all',
    sort: sortRaw === 'name' || sortRaw === 'size' ? sortRaw : 'newest',
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

export function mediaPageCount(total: number, pageSize = MEDIA_PAGE_SIZE): number {
  if (total < 1) return 1;
  return Math.ceil(total / pageSize);
}

export function clampMediaPage(page: number, total: number, pageSize = MEDIA_PAGE_SIZE): number {
  return Math.min(Math.max(1, page), mediaPageCount(total, pageSize));
}
