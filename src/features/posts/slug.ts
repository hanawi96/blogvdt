const LETTERS: Record<string, string> = {
  à: 'a', á: 'a', ạ: 'a', ả: 'a', ã: 'a', â: 'a', ầ: 'a', ấ: 'a', ậ: 'a', ẩ: 'a', ẫ: 'a',
  ă: 'a', ằ: 'a', ắ: 'a', ặ: 'a', ẳ: 'a', ẵ: 'a',
  è: 'e', é: 'e', ẹ: 'e', ẻ: 'e', ẽ: 'e', ê: 'e', ề: 'e', ế: 'e', ệ: 'e', ể: 'e', ễ: 'e',
  ì: 'i', í: 'i', ị: 'i', ỉ: 'i', ĩ: 'i',
  ò: 'o', ó: 'o', ọ: 'o', ỏ: 'o', õ: 'o', ô: 'o', ồ: 'o', ố: 'o', ộ: 'o', ổ: 'o', ỗ: 'o',
  ơ: 'o', ờ: 'o', ớ: 'o', ợ: 'o', ở: 'o', ỡ: 'o',
  ù: 'u', ú: 'u', ụ: 'u', ủ: 'u', ũ: 'u', ư: 'u', ừ: 'u', ứ: 'u', ự: 'u', ử: 'u', ữ: 'u',
  ỳ: 'y', ý: 'y', ỵ: 'y', ỷ: 'y', ỹ: 'y',
  đ: 'd',
};

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Slug bài viết nằm ở root `/{slug}` nên không được trùng các path hệ thống cấp 1
 * (route tĩnh, API, file đặc biệt). Giữ đồng bộ với src/pages và public/.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'admin',
  'api',
  'media',
  'kien-thuc',
  'danh-muc',
  'tag',
  'tim-kiem',
  'san-pham',
  'mau-vong-dau-tam',
  'gio-hang',
  'dat-hang',
  'chinh-sach',
  'lp',
  'sitemap.xml',
  'robots.txt',
  'favicon.svg',
  'favicon.ico',
  '404',
  '_astro',
  '_image',
  // Thư mục asset tĩnh trong public/ (phục vụ ở root).
  'data',
  'fonts',
  'gioi-thieu',
  'lien-he',
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}

export function slugify(value: string): string {
  const lower = value.trim().toLowerCase();
  let result = '';
  for (const char of lower) result += LETTERS[char] ?? char;
  return result
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180);
}
