import { inArray } from 'drizzle-orm';
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
  'og_media_id',
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
  ogImageUrl: string;
  defaultSeoTitle: string;
  defaultSeoDescription: string;
};

export async function getPublicSite(db: AppDb): Promise<PublicSite | null> {
  const values = await getSettings(db);
  if (!values.site_name) return null;
  const images = await mediaByIds(db, [values.logo_media_id, values.favicon_media_id, values.og_media_id]);
  const logo = images.get(Number(values.logo_media_id));
  const favicon = images.get(Number(values.favicon_media_id));
  const ogImage = images.get(Number(values.og_media_id));
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
    ogImageUrl: ogImage?.url ?? '',
    defaultSeoTitle: values.default_seo_title || values.site_name,
    defaultSeoDescription: values.default_seo_description || values.site_description,
  };
}

async function mediaByIds(db: AppDb, idTexts: string[]): Promise<Map<number, { url: string; alt: string }>> {
  const ids = [...new Set(idTexts.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  const found = new Map<number, { url: string; alt: string }>();
  if (ids.length === 0) return found;
  const rows = await db
    .select({ id: media.id, r2Key: media.r2Key, altText: media.altText })
    .from(media)
    .where(inArray(media.id, ids));
  for (const row of rows) found.set(row.id, { url: routes.media(row.r2Key), alt: row.altText });
  return found;
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

const phoneField = z
  .string()
  .trim()
  .max(30, 'Số điện thoại quá dài.')
  .refine((value) => {
    if (!value) return true;
    const digits = value.replace(/\D/g, '');
    return /^[+()\d][\d\s().+-]*$/.test(value) && digits.length >= 8 && digits.length <= 15;
  }, 'Số điện thoại không hợp lệ.');

const settingsFields = z.object({
  site_name: z.string().trim().min(1, 'Nhập tên website.').max(120, 'Tên website quá dài.'),
  site_description: z.string().trim().max(300, 'Mô tả quá dài.'),
  phone: phoneField,
  contact_info: z.string().trim().max(300, 'Địa chỉ quá dài.'),
  facebook_url: optionalUrl,
  zalo_url: optionalUrl,
  logo_media_id: z.string().trim().max(20),
  favicon_media_id: z.string().trim().max(20),
  og_media_id: z.string().trim().max(20),
  default_seo_title: z.string().trim().max(180, 'SEO title quá dài.'),
  default_seo_description: z.string().trim().max(300, 'Mô tả SEO quá dài.'),
});

export function parseSettingsForm(form: FormData): { ok: true; values: SiteSettingValues } | { ok: false; errors: FieldErrors } {
  const raw = Object.fromEntries(SETTING_KEYS.map((key) => [key, stringField(form, key)]));
  const parsed = settingsFields.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  for (const key of ['logo_media_id', 'favicon_media_id', 'og_media_id'] as const) {
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

export function changedSettingKeys(current: SiteSettingValues, next: SiteSettingValues): SettingKey[] {
  return SETTING_KEYS.filter((key) => current[key] !== next[key]);
}

export async function saveSettings(db: AppDb, values: SiteSettingValues, now = Date.now()): Promise<number> {
  const keys = changedSettingKeys(await getSettings(db), values);
  if (keys.length === 0) return 0;
  await runBatch(
    db,
    keys.map((key) =>
      db
        .insert(siteSettings)
        .values({ key, value: values[key], updatedAt: now })
        .onConflictDoUpdate({ target: siteSettings.key, set: { value: values[key], updatedAt: now } }),
    ),
  );
  return keys.length;
}
