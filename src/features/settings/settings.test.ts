import { describe, expect, it } from 'vitest';
import { changedSettingKeys, parseSettingsForm, SETTING_KEYS, type SiteSettingValues } from './settings';

function form(overrides: Partial<SiteSettingValues> = {}): FormData {
  const data = new FormData();
  for (const key of SETTING_KEYS) data.set(key, overrides[key] ?? '');
  if (!overrides.site_name) data.set('site_name', 'Vòng dâu');
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

  it('chỉ nhận các khóa cài đặt đã đổi', () => {
    const current = Object.fromEntries(SETTING_KEYS.map((key) => [key, ''])) as SiteSettingValues;
    current.site_name = 'Vòng dâu';
    const next = { ...current, phone: '0901234567' };
    expect(changedSettingKeys(current, next)).toEqual(['phone']);
    expect(changedSettingKeys(current, current)).toEqual([]);
  });
});
