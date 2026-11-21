/** Tên in lên thẻ — bắt buộc khi tên SP có chữ «thẻ». */

export const TAG_NAME_MAX = 40;

export function productRequiresTagName(productName: string): boolean {
  return productName.toLowerCase().includes('thẻ');
}

/** Trả tên đã chuẩn hóa; null nếu trống; 'bad' nếu quá dài. */
export function readTagName(raw: string): string | null | 'bad' {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (!name) return null;
  if (name.length > TAG_NAME_MAX) return 'bad';
  return name;
}

/** Ghi vào order_items.note — luôn có «thẻ» để chip admin nhận diện. */
export function tagNameToLineNote(name: string): string {
  const trimmed = name.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  if (trimmed.toLowerCase().includes('thẻ')) return trimmed.slice(0, 160);
  return `thẻ: ${trimmed}`.slice(0, 160);
}
