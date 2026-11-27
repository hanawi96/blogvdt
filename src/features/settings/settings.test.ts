import { describe, expect, it } from 'vitest';
import { changedSettingKeys, parseOpenDays, parseSettingsForm, SETTING_KEYS, type SiteSettingValues } from './settings';

function form(overrides: Partial<SiteSettingValues> = {}, openDays: string[] = []): FormData {
  const data = new FormData();
  for (const key of SETTING_KEYS) data.set(key, overrides[key] ?? '');
  if (!overrides.site_name) data.set('site_name', 'Vòng dâu');
  for (const day of openDays) data.append('open_day', day);
  return data;
}

describe('cài đặt website', () => {
  it('nhận điện thoại và URL hợp lệ, từ chối giá trị sai', () => {
    expect(parseSettingsForm(form({ phone: '0901234567', facebook_url: 'https://facebook.com/vong' })).ok).toBe(true);
    const badPhone = parseSettingsForm(form({ phone: 'abc' }));
    expect(badPhone.ok).toBe(false);
    if (!badPhone.ok) expect(badPhone.errors.phone).toBe('Số điện thoại không hợp lệ.');
    const badUrl = parseSettingsForm(form({ zalo_url: 'zalo.me/1' }));
    expect(badUrl.ok).toBe(false);
    if (!badUrl.ok) expect(badUrl.errors.zalo_url).toContain('http');
  });

  it('nhận email, tọa độ, giờ mở cửa và ngày từ checkbox', () => {
    const ok = parseSettingsForm(
      form(
        {
          contact_email: 'hello@shop.vn',
          geo_latitude: '21.16',
          geo_longitude: '105.73',
          opens_at: '08:00',
          closes_at: '20:00',
          instagram_url: 'https://instagram.com/shop',
        },
        ['Monday', 'Friday', 'Monday'],
      ),
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.values.open_days).toBe('Monday,Friday');
      expect(ok.values.contact_email).toBe('hello@shop.vn');
      expect(ok.values.instagram_url).toBe('https://instagram.com/shop');
    }
    const badEmail = parseSettingsForm(form({ contact_email: 'not-mail' }));
    expect(badEmail.ok).toBe(false);
    if (!badEmail.ok) expect(badEmail.errors.contact_email).toContain('Email');
    const halfGeo = parseSettingsForm(form({ geo_latitude: '21.1' }));
    expect(halfGeo.ok).toBe(false);
    const halfHours = parseSettingsForm(form({ opens_at: '08:00', closes_at: '20:00' }));
    expect(halfHours.ok).toBe(false);
    expect(parseOpenDays('Monday, Foo, Tuesday')).toEqual(['Monday', 'Tuesday']);
  });

  it('chỉ nhận các khóa cài đặt đã đổi', () => {
    const current = Object.fromEntries(SETTING_KEYS.map((key) => [key, ''])) as SiteSettingValues;
    current.site_name = 'Vòng dâu';
    const next = { ...current, phone: '0901234567' };
    expect(changedSettingKeys(current, next)).toEqual(['phone']);
    expect(changedSettingKeys(current, current)).toEqual([]);
  });
});
