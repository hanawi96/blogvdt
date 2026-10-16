/** Chuẩn hóa từ khóa công khai: bỏ LIKE wildcards, gọn, giới hạn độ dài. */
export function normalizeSearchQuery(raw: string | null | undefined, max = 80): string {
  return (raw ?? '').replace(/[%_]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function searchQueryReady(term: string, min = 2): boolean {
  return term.length >= min;
}
