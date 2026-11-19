/** Giá trị lưu DB — khớp import catalog (`bracelet_type`). */
export const CORD_TYPES = ['adjustable', 'elastic', 'other'] as const;
export type CordType = (typeof CORD_TYPES)[number];

export const CORD_TYPE_LABELS: Record<CordType, string> = {
  adjustable: 'Dây rút',
  elastic: 'Dây co giãn',
  other: 'Khác',
};

/** Chuẩn hóa giá trị DB / legacy tiếng Việt → adjustable | elastic | other | ''. */
export function normalizeCordType(value: string | null | undefined): CordType | '' {
  if (value === 'adjustable' || value === 'Dây rút') return 'adjustable';
  if (value === 'elastic' || value === 'Dây co giãn') return 'elastic';
  if (value === 'other' || value === 'Khác') return 'other';
  return '';
}

export function isCordType(value: string): value is CordType {
  return (CORD_TYPES as readonly string[]).includes(value);
}

export function cordTypeLabel(value: string | null | undefined): string {
  const kind = normalizeCordType(value);
  return kind ? CORD_TYPE_LABELS[kind] : '';
}

/** Tên hiển thị trên card công khai; không đổi tên lưu DB. `other`/rỗng → không tiền tố. */
export function productCardName(name: string, cordType: string | null | undefined): string {
  const kind = normalizeCordType(cordType);
  if (kind === 'adjustable') return `[DÂY RÚT] ${name}`;
  if (kind === 'elastic') return `[CO GIÃN] ${name}`;
  return name;
}
