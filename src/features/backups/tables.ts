/** Bảng nghiệp vụ cho backup partial (không gồm hệ thống nội bộ). */
export const BACKUP_TABLE_WHITELIST = [
  'admin_users',
  'categories',
  'tags',
  'posts',
  'post_categories',
  'post_tags',
  'media',
  'product_categories',
  'products',
  'product_category_links',
  'product_media',
  'product_materials',
  'product_comments',
  'customers',
  'orders',
  'order_items',
  'order_costs',
  'materials',
  'material_groups',
  'discount_codes',
  'discount_checks',
  'ad_spend',
  'redirects',
  'site_settings',
  'feedback_photos',
  'activity_logs',
  'chat_phone_maps',
  'order_exports',
  'order_export_items',
  'invoice_exports',
  'invoice_export_items',
  'seo_health_runs',
  'seo_health_posts',
  'seo_health_issues',
  'seo_health_links',
  'backup_jobs',
  'backup_settings',
] as const;

export type BackupTableName = (typeof BACKUP_TABLE_WHITELIST)[number];

const ALLOWED = new Set<string>(BACKUP_TABLE_WHITELIST);

export function sanitizeBackupTables(input: unknown): string[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const picked = [...new Set(input.map((item) => String(item)).filter((name) => ALLOWED.has(name)))];
  return picked.length > 0 ? picked : null;
}

/**
 * Partial bắt buộc có bảng hợp lệ — không được fallback sang export full.
 * Full trả null (= không lọc bảng trên D1 Export API).
 */
export function tablesForD1Export(kind: 'full' | 'partial', tablesJson: string | null): string[] | null {
  if (kind !== 'partial') return null;
  if (!tablesJson?.trim()) {
    throw new Error('Backup partial thiếu danh sách bảng.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(tablesJson);
  } catch {
    throw new Error('Backup partial có tables_json không hợp lệ.');
  }
  const tables = sanitizeBackupTables(parsed);
  if (!tables) {
    throw new Error('Backup partial không còn bảng hợp lệ trong whitelist.');
  }
  return tables;
}
