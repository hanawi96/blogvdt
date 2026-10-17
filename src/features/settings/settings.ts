import { inArray } from 'drizzle-orm';
import { z } from 'zod';
import { activityWrite, commitWrites, type ActivityActor } from '../activity/log';
import type { AppDb } from '../../lib/db/client';
import { media, siteSettings } from '../../lib/db/schema';
import { isHttpUrl } from '../../lib/http';
import { routes } from '../../lib/routes';
import { fieldErrors, type FieldErrors } from '../../lib/validation/errors';
import { cleanTracking, trackingErrors, type Tracking } from '../tracking/tracking';

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
  'meta_pixel_id',
  'ga_measurement_id',
  'google_ads_id',
  'google_ads_label',
  'tiktok_pixel_id',
  'gtm_id',
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
  ogImageAlt: string;
  ogImageWidth: number | null;
  ogImageHeight: number | null;
  defaultSeoTitle: string;
  defaultSeoDescription: string;
  tracking: Tracking;
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
    ogImageAlt: ogImage?.alt ?? '',
    ogImageWidth: ogImage?.width ?? null,
    ogImageHeight: ogImage?.height ?? null,
    defaultSeoTitle: values.default_seo_title || values.site_name,
    defaultSeoDescription: values.default_seo_description || values.site_description,
    tracking: siteTracking(values),
  };
}

async function mediaByIds(db: AppDb, idTexts: string[]): Promise<Map<number, { url: string; alt: string; width: number | null; height: number | null }>> {
  const ids = [...new Set(idTexts.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  const found = new Map<number, { url: string; alt: string; width: number | null; height: number | null }>();
  if (ids.length === 0) return found;
  const rows = await db
    .select({ id: media.id, r2Key: media.r2Key, altText: media.altText, width: media.width, height: media.height })
    .from(media)
    .where(inArray(media.id, ids));
  for (const row of rows) found.set(row.id, { url: routes.media(row.r2Key), alt: row.altText, width: row.width, height: row.height });
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
  // Định dạng chi tiết do trackingErrors kiểm (một nguồn chung với landing); zod chỉ chặn độ dài.
  meta_pixel_id: z.string().trim().max(40),
  ga_measurement_id: z.string().trim().max(40),
  google_ads_id: z.string().trim().max(40),
  google_ads_label: z.string().trim().max(60),
  tiktok_pixel_id: z.string().trim().max(40),
  gtm_id: z.string().trim().max(40),
});

// Ánh xạ field tracking (snake_case trong settings) sang khóa Tracking (camelCase) để validate chung.
const TRACKING_FIELD_MAP = {
  meta_pixel_id: 'metaPixelId',
  ga_measurement_id: 'gaMeasurementId',
  google_ads_id: 'googleAdsId',
  google_ads_label: 'googleAdsLabel',
  tiktok_pixel_id: 'tiktokPixelId',
  gtm_id: 'gtmId',
} as const;

export function parseSettingsForm(form: FormData): { ok: true; values: SiteSettingValues } | { ok: false; errors: FieldErrors } {
  const raw = Object.fromEntries(SETTING_KEYS.map((key) => [key, stringField(form, key)]));
  const parsed = settingsFields.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  for (const key of ['logo_media_id', 'favicon_media_id', 'og_media_id'] as const) {
    if (parsed.data[key] && !/^[1-9]\d*$/.test(parsed.data[key])) {
      return { ok: false, errors: { [key]: 'Ảnh không hợp lệ.' } };
    }
  }
  // Kiểm định dạng ID theo dõi bằng cùng quy tắc với trang đích.
  const trackingInput = Object.fromEntries(
    Object.entries(TRACKING_FIELD_MAP).map(([settingKey, trackingKey]) => [trackingKey, parsed.data[settingKey as keyof typeof parsed.data]]),
  ) as Record<keyof Tracking, string>;
  const tErrors = trackingErrors(trackingInput);
  const firstError = Object.entries(tErrors)[0];
  if (firstError) {
    const settingKey = (Object.entries(TRACKING_FIELD_MAP).find(([, tk]) => tk === firstError[0]) ?? [])[0];
    if (settingKey) return { ok: false, errors: { [settingKey]: firstError[1] } };
  }
  return { ok: true, values: parsed.data };
}

export function siteTracking(values: SiteSettingValues): Tracking {
  return cleanTracking({
    metaPixelId: values.meta_pixel_id,
    gaMeasurementId: values.ga_measurement_id,
    googleAdsId: values.google_ads_id,
    googleAdsLabel: values.google_ads_label,
    tiktokPixelId: values.tiktok_pixel_id,
    gtmId: values.gtm_id,
  });
}

function stringField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

export function changedSettingKeys(current: SiteSettingValues, next: SiteSettingValues): SettingKey[] {
  return SETTING_KEYS.filter((key) => current[key] !== next[key]);
}

export async function saveSettings(db: AppDb, values: SiteSettingValues, now = Date.now(), actor?: ActivityActor): Promise<number> {
  const keys = changedSettingKeys(await getSettings(db), values);
  if (keys.length === 0) return 0;
  await commitWrites(db, [
    ...keys.map((key) =>
      db
        .insert(siteSettings)
        .values({ key, value: values[key], updatedAt: now })
        .onConflictDoUpdate({ target: siteSettings.key, set: { value: values[key], updatedAt: now } }),
    ),
    ...(actor
      ? [
          activityWrite(
            db,
            {
              actorId: actor.id,
              actorName: actor.name,
              action: 'settings.update',
              objectType: 'settings',
              objectId: null,
              summary: 'Đã cập nhật cài đặt.',
              createdAt: now,
            },
            false,
          ),
        ]
      : []),
  ]);
  return keys.length;
}
