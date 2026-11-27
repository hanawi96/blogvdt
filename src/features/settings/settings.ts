import { inArray } from 'drizzle-orm';
import { z } from 'zod';
import { activityWrite, commitWrites, type ActivityActor } from '../activity/log';
import type { AppDb } from '../../lib/db/client';
import { media, siteSettings } from '../../lib/db/schema';
import { isHttpUrl } from '../../lib/http';
import { routes } from '../../lib/routes';
import { fieldErrors, type FieldErrors } from '../../lib/validation/errors';
import { cleanTracking, trackingErrors, type Tracking } from '../tracking/tracking';

/** Ngày schema.org dùng trong open_days (comma-separated). */
export const OPEN_DAY_VALUES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
export type OpenDay = (typeof OPEN_DAY_VALUES)[number];

export const OPEN_DAY_OPTIONS: ReadonlyArray<{ value: OpenDay; label: string }> = [
  { value: 'Monday', label: 'Thứ 2' },
  { value: 'Tuesday', label: 'Thứ 3' },
  { value: 'Wednesday', label: 'Thứ 4' },
  { value: 'Thursday', label: 'Thứ 5' },
  { value: 'Friday', label: 'Thứ 6' },
  { value: 'Saturday', label: 'Thứ 7' },
  { value: 'Sunday', label: 'Chủ nhật' },
];

export const SETTING_KEYS = [
  'site_name',
  'site_description',
  'phone',
  'contact_email',
  'contact_info',
  'address_locality',
  'address_region',
  'postal_code',
  'geo_latitude',
  'geo_longitude',
  'opens_at',
  'closes_at',
  'open_days',
  'facebook_url',
  'zalo_url',
  'instagram_url',
  'tiktok_url',
  'youtube_url',
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
  contactEmail: string;
  contactInfo: string;
  addressLocality: string;
  addressRegion: string;
  postalCode: string;
  geoLatitude: string;
  geoLongitude: string;
  opensAt: string;
  closesAt: string;
  openDays: string;
  facebookUrl: string;
  zaloUrl: string;
  instagramUrl: string;
  tiktokUrl: string;
  youtubeUrl: string;
  logoUrl: string;
  logoAlt: string;
  logoWidth: number | null;
  logoHeight: number | null;
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
    contactEmail: values.contact_email,
    contactInfo: values.contact_info,
    addressLocality: values.address_locality,
    addressRegion: values.address_region,
    postalCode: values.postal_code,
    geoLatitude: values.geo_latitude,
    geoLongitude: values.geo_longitude,
    opensAt: values.opens_at,
    closesAt: values.closes_at,
    openDays: values.open_days,
    facebookUrl: isHttpUrl(values.facebook_url) ? values.facebook_url : '',
    zaloUrl: isHttpUrl(values.zalo_url) ? values.zalo_url : '',
    instagramUrl: isHttpUrl(values.instagram_url) ? values.instagram_url : '',
    tiktokUrl: isHttpUrl(values.tiktok_url) ? values.tiktok_url : '',
    youtubeUrl: isHttpUrl(values.youtube_url) ? values.youtube_url : '',
    logoUrl: logo?.url ?? '',
    logoAlt: logo?.alt || values.site_name,
    logoWidth: logo?.width ?? null,
    logoHeight: logo?.height ?? null,
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

const optionalEmail = z
  .string()
  .trim()
  .max(120, 'Email quá dài.')
  .refine((value) => value === '' || z.string().email().safeParse(value).success, 'Email không hợp lệ.');

const optionalTime = z
  .string()
  .trim()
  .max(5)
  .refine((value) => value === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(value), 'Giờ cần dạng HH:MM (ví dụ 08:00).');

const optionalCoord = (kind: 'latitude' | 'longitude') =>
  z
    .string()
    .trim()
    .max(20, 'Tọa độ quá dài.')
    .refine((value) => {
      if (!value) return true;
      if (!/^-?\d+(\.\d+)?$/.test(value)) return false;
      const num = Number(value);
      if (kind === 'latitude') return num >= -90 && num <= 90;
      return num >= -180 && num <= 180;
    }, kind === 'latitude' ? 'Vĩ độ không hợp lệ (−90 đến 90).' : 'Kinh độ không hợp lệ (−180 đến 180).');

const settingsFields = z.object({
  site_name: z.string().trim().min(1, 'Nhập tên website.').max(120, 'Tên website quá dài.'),
  site_description: z.string().trim().max(300, 'Mô tả quá dài.'),
  phone: phoneField,
  contact_email: optionalEmail,
  contact_info: z.string().trim().max(300, 'Địa chỉ quá dài.'),
  address_locality: z.string().trim().max(120, 'Phường/xã hoặc quận/huyện quá dài.'),
  address_region: z.string().trim().max(120, 'Tỉnh/thành quá dài.'),
  postal_code: z.string().trim().max(20, 'Mã bưu chính quá dài.'),
  geo_latitude: optionalCoord('latitude'),
  geo_longitude: optionalCoord('longitude'),
  opens_at: optionalTime,
  closes_at: optionalTime,
  open_days: z.string().trim().max(120),
  facebook_url: optionalUrl,
  zalo_url: optionalUrl,
  instagram_url: optionalUrl,
  tiktok_url: optionalUrl,
  youtube_url: optionalUrl,
  logo_media_id: z.string().trim().max(20),
  favicon_media_id: z.string().trim().max(20),
  og_media_id: z.string().trim().max(20),
  default_seo_title: z.string().trim().max(180, 'SEO title quá dài.'),
  default_seo_description: z.string().trim().max(300, 'Mô tả SEO quá dài.'),
  // Định dạng chi tiết do trackingErrors kiểm; zod chỉ chặn độ dài.
  meta_pixel_id: z.string().trim().max(40),
  ga_measurement_id: z.string().trim().max(40),
  google_ads_id: z.string().trim().max(40),
  google_ads_label: z.string().trim().max(60),
  tiktok_pixel_id: z.string().trim().max(40),
  gtm_id: z.string().trim().max(40),
}).superRefine((data, ctx) => {
  const hasLat = Boolean(data.geo_latitude);
  const hasLng = Boolean(data.geo_longitude);
  if (hasLat !== hasLng) {
    ctx.addIssue({
      code: 'custom',
      path: [hasLat ? 'geo_longitude' : 'geo_latitude'],
      message: 'Nhập đủ cả vĩ độ và kinh độ, hoặc để trống cả hai.',
    });
  }
  const hasOpen = Boolean(data.opens_at);
  const hasClose = Boolean(data.closes_at);
  const hasDays = Boolean(data.open_days);
  if ((hasOpen || hasClose || hasDays) && !(hasOpen && hasClose && hasDays)) {
    ctx.addIssue({
      code: 'custom',
      path: ['opens_at'],
      message: 'Giờ mở cửa cần đủ giờ mở, giờ đóng và ít nhất một ngày.',
    });
  }
  if (hasOpen && hasClose && data.opens_at >= data.closes_at) {
    ctx.addIssue({
      code: 'custom',
      path: ['closes_at'],
      message: 'Giờ đóng phải sau giờ mở.',
    });
  }
});

export function parseOpenDays(value: string): OpenDay[] {
  const allowed = new Set<string>(OPEN_DAY_VALUES);
  const seen = new Set<OpenDay>();
  const days: OpenDay[] = [];
  for (const part of value.split(/[,\s]+/)) {
    if (!allowed.has(part) || seen.has(part as OpenDay)) continue;
    seen.add(part as OpenDay);
    days.push(part as OpenDay);
  }
  return days;
}

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
  const raw = Object.fromEntries(SETTING_KEYS.map((key) => [key, stringField(form, key)])) as SiteSettingValues;
  // Checkbox ngày mở cửa → open_days chuẩn schema.org.
  raw.open_days = parseOpenDays(
    [...form.getAll('open_day'), stringField(form, 'open_days')].filter((item): item is string => typeof item === 'string').join(','),
  ).join(',');
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
