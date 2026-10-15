import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const adminUsers = sqliteTable(
  'admin_users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    username: text('username').notNull().unique(),
    displayName: text('display_name').notNull().default(''),
    email: text('email').unique(),
    avatarMediaId: integer('avatar_media_id'),
    bio: text('bio').notNull().default(''),
    facebookUrl: text('facebook_url'),
    zaloUrl: text('zalo_url'),
    instagramUrl: text('instagram_url'),
    tiktokUrl: text('tiktok_url'),
    websiteUrl: text('website_url'),
    role: text('role').notNull().default('admin'),
    status: text('status').notNull().default('active'),
    // pbkdf2-sha256$<số vòng>$<salt base64>$<hash base64>. Web Crypto, 100000 vòng.
    passwordHash: text('password_hash').notNull(),
    lastLoginAt: integer('last_login_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    check('admin_users_role_check', sql`${table.role} in ('admin', 'editor')`),
    check('admin_users_status_check', sql`${table.status} in ('active', 'invited', 'disabled')`),
  ],
);

export const passwordResets = sqliteTable(
  'password_resets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: integer('expires_at').notNull(),
    usedAt: integer('used_at'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('password_resets_user_idx').on(table.userId)],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    adminUserId: integer('admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    csrfToken: text('csrf_token').notNull(),
    expiresAt: integer('expires_at').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('sessions_admin_user_idx').on(table.adminUserId),
    index('sessions_expires_at_idx').on(table.expiresAt),
  ],
);

export const loginAttempts = sqliteTable('login_attempts', {
  ipHash: text('ip_hash').primaryKey(),
  failCount: integer('fail_count').notNull(),
  lockedUntil: integer('locked_until'),
  updatedAt: integer('updated_at').notNull(),
});

export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  seoTitle: text('seo_title'),
  metaDescription: text('meta_description'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const media = sqliteTable('media', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  r2Key: text('r2_key').notNull().unique(),
  filename: text('filename').notNull(),
  altText: text('alt_text').notNull().default(''),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  width: integer('width'),
  height: integer('height'),
  createdAt: integer('created_at').notNull(),
});

export const posts = sqliteTable(
  'posts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    categoryId: integer('category_id').references(() => categories.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    slug: text('slug').notNull().unique(),
    excerpt: text('excerpt').notNull().default(''),
    coverMediaId: integer('cover_media_id').references(() => media.id, { onDelete: 'set null' }),
    contentJson: text('content_json').notNull(),
    seoTitle: text('seo_title'),
    metaDescription: text('meta_description'),
    status: text('status').notNull(),
    publishedAt: integer('published_at'),
    deletedAt: integer('deleted_at'),
    deletedBy: integer('deleted_by'),
    authorId: integer('author_id').references(() => adminUsers.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('posts_status_published_idx').on(table.status, table.publishedAt),
    index('posts_category_idx').on(table.categoryId),
    index('posts_deleted_at_idx').on(table.deletedAt),
    check('posts_status_check', sql`${table.status} in ('draft', 'published')`),
  ],
);

export const productCategories = sqliteTable('product_categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description').notNull().default(''),
  coverMediaId: integer('cover_media_id').references(() => media.id, { onDelete: 'set null' }),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const products = sqliteTable(
  'products',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    categoryId: integer('category_id').references(() => productCategories.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    price: integer('price').notNull(),
    comparePrice: integer('compare_price'),
    cordType: text('cord_type').notNull().default(''),
    description: text('description').notNull().default(''),
    coverMediaId: integer('cover_media_id').references(() => media.id, { onDelete: 'set null' }),
    optionsJson: text('options_json').notNull().default('[]'),
    status: text('status').notNull(),
    isFeatured: integer('is_featured', { mode: 'boolean' }).notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    seoTitle: text('seo_title'),
    metaDescription: text('meta_description'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('products_status_idx').on(table.status),
    index('products_featured_idx').on(table.isFeatured),
    index('products_category_idx').on(table.categoryId),
    check('products_status_check', sql`${table.status} in ('active', 'inactive')`),
    check('products_price_check', sql`${table.price} >= 0`),
    check('products_compare_price_check', sql`${table.comparePrice} is null or ${table.comparePrice} >= 0`),
  ],
);

export const productMedia = sqliteTable(
  'product_media',
  {
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    mediaId: integer('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.productId, table.mediaId] })],
);

export const orders = sqliteTable(
  'orders',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    code: text('code').notNull().unique(),
    customerName: text('customer_name').notNull(),
    phone: text('phone').notNull(),
    address: text('address').notNull(),
    note: text('note'),
    internalNote: text('internal_note'),
    productId: integer('product_id').references(() => products.id, { onDelete: 'set null' }),
    productName: text('product_name').notNull(),
    unitPrice: integer('unit_price').notNull(),
    quantity: integer('quantity').notNull(),
    optionLabel: text('option_label'),
    totalPrice: integer('total_price').notNull(),
    status: text('status').notNull(),
    ipHash: text('ip_hash').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('orders_status_idx').on(table.status),
    index('orders_created_at_idx').on(table.createdAt),
    index('orders_phone_idx').on(table.phone),
    check(
      'orders_status_check',
      sql`${table.status} in ('new', 'confirmed', 'preparing', 'shipped', 'completed', 'cancelled')`,
    ),
    check('orders_quantity_check', sql`${table.quantity} > 0`),
    check('orders_unit_price_check', sql`${table.unitPrice} >= 0`),
  ],
);

export const orderItems = sqliteTable(
  'order_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: integer('product_id').references(() => products.id, { onDelete: 'set null' }),
    productName: text('product_name').notNull(),
    unitPrice: integer('unit_price').notNull(),
    quantity: integer('quantity').notNull(),
    optionLabel: text('option_label'),
    lineTotal: integer('line_total').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    index('order_items_order_idx').on(table.orderId),
    check('order_items_quantity_check', sql`${table.quantity} > 0`),
    check('order_items_price_check', sql`${table.unitPrice} >= 0`),
  ],
);

export const redirects = sqliteTable(
  'redirects',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    fromPath: text('from_path').notNull().unique(),
    toPath: text('to_path').notNull(),
    statusCode: integer('status_code').notNull().default(301),
    enabled: integer('enabled').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull().default(0),
  },
  (table) => [index('redirects_to_path_idx').on(table.toPath)],
);

export const siteSettings = sqliteTable('site_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// Tên người thao tác được chụp tại thời điểm ghi. Xóa tài khoản không xóa nhật ký.
export const activityLogs = sqliteTable(
  'activity_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    actorId: integer('actor_id').references(() => adminUsers.id, { onDelete: 'set null' }),
    actorName: text('actor_name').notNull(),
    action: text('action').notNull(),
    objectType: text('object_type').notNull(),
    objectId: text('object_id'),
    summary: text('summary').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('activity_logs_recent_idx').on(table.createdAt, table.id),
    index('activity_logs_actor_idx').on(table.actorId, table.action, table.objectType, table.objectId, table.createdAt),
    index('activity_logs_action_idx').on(table.action, table.createdAt),
  ],
);

// Một lần kiểm tra SEO. Trang đọc bản đã lưu, không quét lại khi mở trang.
export const seoHealthRuns = sqliteTable(
  'seo_health_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
    phase: text('phase').notNull().default('posts'),
    cursor: integer('cursor').notNull().default(0),
    linksTruncated: integer('links_truncated').notNull().default(0),
  },
  (table) => [check('seo_health_runs_phase_check', sql`${table.phase} in ('posts', 'links', 'inbound', 'done')`)],
);

export const seoHealthPosts = sqliteTable(
  'seo_health_posts',
  {
    runId: integer('run_id')
      .notNull()
      .references(() => seoHealthRuns.id, { onDelete: 'cascade' }),
    postId: integer('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.runId, table.postId] })],
);

export const seoHealthLinks = sqliteTable(
  'seo_health_links',
  {
    runId: integer('run_id')
      .notNull()
      .references(() => seoHealthRuns.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.path] })],
);

export const seoHealthIssues = sqliteTable(
  'seo_health_issues',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    runId: integer('run_id')
      .notNull()
      .references(() => seoHealthRuns.id, { onDelete: 'cascade' }),
    postId: integer('post_id').references(() => posts.id, { onDelete: 'cascade' }),
    postTitle: text('post_title').notNull().default(''),
    severity: text('severity').notNull(),
    code: text('code').notNull(),
    detail: text('detail').notNull(),
  },
  (table) => [
    index('seo_health_issues_filter_idx').on(table.runId, table.severity, table.code, table.postId),
    check('seo_health_issues_severity_check', sql`${table.severity} in ('error', 'warning')`),
  ],
);
