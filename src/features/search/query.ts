import { routes } from '../../lib/routes';

/** Chuẩn hóa từ khóa công khai: bỏ LIKE wildcards, gọn, giới hạn độ dài. */
export function normalizeSearchQuery(raw: string | null | undefined, max = 80): string {
  return (raw ?? '').replace(/[%_]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function searchQueryReady(term: string, min = 2): boolean {
  return term.length >= min;
}

export const SEARCH_KINDS = ['san-pham', 'bai-viet'] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export function readSearchKind(raw: string | null | undefined): SearchKind | null {
  return raw === 'san-pham' || raw === 'bai-viet' ? raw : null;
}

export function readSearchPage(raw: string | null | undefined): number {
  const page = Number(raw ?? '1');
  return Number.isInteger(page) && page > 0 ? page : 1;
}

/** URL trang kết quả; overview không gắn loai/page. */
export function searchPath(
  q: string,
  opts: { kind?: SearchKind | null; page?: number } = {},
): string {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (opts.kind) params.set('loai', opts.kind);
  if (opts.page && opts.page > 1) params.set('page', String(opts.page));
  const text = params.toString();
  return text ? `${routes.search}?${text}` : routes.search;
}
