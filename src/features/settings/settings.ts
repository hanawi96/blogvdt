import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { runBatch } from '../../lib/db/batch';
import type { AppDb } from '../../lib/db/client';
import { media, siteSettings } from '../../lib/db/schema';
import { isHttpUrl } from '../../lib/http';
import { routes } from '../../lib/routes';
import { fieldErrors, type FieldErrors } from '../../lib/validation/errors';

export const SETTING_KEYS = [
  'site_name',
  'site_description',
  'phone',
  'contact_info',
  'facebook_url',
  'zalo_url',
  'logo_media_id',
  'favicon_media_id',
  'default_seo_title',
  'default_seo_description',
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

function isSettingKey(key: string): key is SettingKey {
  return SETTING_KEYS.some((item) => item === key);
}
export type SiteSettingValues = Record<SettingKey, string>;

export type PublicSite = {
  siteName: string;
  siteDescription: string;
  phone: string;
  contactInfo: string;
  facebookUrl: string;
  zaloUrl: string;
  logoUrl: string;
  logoAlt: string;
  faviconUrl: string;
  defaultSeoTitle: string;
  defaultSeoDescription: string;
};

export async function getPublicSite(db: AppDb): Promise<PublicSite | null> {
  const values = await getSettings(db);
  if (!values.site_name) return null;
  const [logo, favicon] = await Promise.all([
    mediaById(db, values.logo_media_id),
    mediaById(db, values.favicon_media_id),
  ]);
  return {
    siteName: values.site_name,
    siteDescription: values.site_description,
    phone: values.phone,
    contactInfo: values.contact_info,
    facebookUrl: isHttpUrl(values.facebook_url) ? values.facebook_url : '',
    zaloUrl: isHttpUrl(values.zalo_url) ? values.zalo_url : '',
    logoUrl: logo?.url ?? '',
    logoAlt: logo?.alt || values.site_name,
    faviconUrl: favicon?.url ?? '',
    defaultSeoTitle: values.default_seo_title || values.site_name,
    defaultSeoDescription: values.default_seo_description || values.site_description,
  };
}

async function mediaById(db: AppDb, idText: string): Promise<{ url: string; alt: string } | null> {
  const id = Number(idText);
  if (!Number.isInteger(id) || id < 1) return null;
  const rows = await db
    .select({ r2Key: media.r2Key, altText: media.altText })
    .from(media)
    .where(eq(media.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { url: routes.media(row.r2Key), alt: row.altText };
}

export async function getSettings(db: AppDb): Promise<SiteSettingValues> {
  const rows = await db.select({ key: siteSettings.key, value: siteSettings.value }).from(siteSettings);
  const values = Object.fromEntries(SETTING_KEYS.map((key) => [key, ''])) as SiteSettingValues;
  for (const row of rows) {
    if (isSettingKey(row.key)) values[row.key] = row.value;
  }
  return values;
}

const optionalUrl = z
  .string()
  .trim()
  .max(300, 'Liên kết quá dài.')
  .refine((value) => value === '' || isHttpUrl(value), 'Liên kết cần bắt đầu bằng http hoặc https.');

const settingsFields = z.object({
  site_name: z.string().trim().min(1, 'Nhập tên website.').max(120, 'Tên website quá dài.'),
  site_description: z.string().trim().max(300, 'Mô tả quá dài.'),
  phone: z.string().trim().max(30, 'Số điện thoại quá dài.'),
  contact_info: z.string().trim().max(300, 'Thông tin liên hệ quá dài.'),
  facebook_url: optionalUrl,
  zalo_url: optionalUrl,
  logo_media_id: z.string().trim().max(20),
  favicon_media_id: z.string().trim().max(20),
  default_seo_title: z.string().trim().max(180, 'SEO title quá dài.'),
  default_seo_description: z.string().trim().max(300, 'Mô tả SEO quá dài.'),
});

export function parseSettingsForm(form: FormData): { ok: true; values: SiteSettingValues } | { ok: false; errors: FieldErrors } {
  const raw = Object.fromEntries(SETTING_KEYS.map((key) => [key, stringField(form, key)]));
  const parsed = settingsFields.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  for (const key of ['logo_media_id', 'favicon_media_id'] as const) {
    if (parsed.data[key] && !/^[1-9]\d*$/.test(parsed.data[key])) {
      return { ok: false, errors: { [key]: 'Ảnh không hợp lệ.' } };
    }
  }
  return { ok: true, values: parsed.data };
}

function stringField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

export async function saveSettings(db: AppDb, values: SiteSettingValues, now = Date.now()): Promise<void> {
  await runBatch(
    db,
    SETTING_KEYS.map((key) =>
      db
        .insert(siteSettings)
        .values({ key, value: values[key], updatedAt: now })
        .onConflictDoUpdate({ target: siteSettings.key, set: { value: values[key], updatedAt: now } }),
    ),
  );
}
