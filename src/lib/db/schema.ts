import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const adminUsers = sqliteTable('admin_users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  // pbkdf2-sha256$<số vòng>$<salt base64>$<hash base64>. Web Crypto, 100000 vòng.
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

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
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('posts_status_published_idx').on(table.status, table.publishedAt),
    index('posts_category_idx').on(table.categoryId),
    check('posts_status_check', sql`${table.status} in ('draft', 'published')`),
  ],
);

export const products = sqliteTable(
  'products',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    price: integer('price').notNull(),
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
    check('products_status_check', sql`${table.status} in ('active', 'inactive')`),
    check('products_price_check', sql`${table.price} >= 0`),
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

export const redirects = sqliteTable('redirects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  fromPath: text('from_path').notNull().unique(),
  toPath: text('to_path').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const siteSettings = sqliteTable('site_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
