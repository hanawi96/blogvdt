import { describe, expect, it } from 'vitest';
import {
  EMPTY_TRACKING,
  buildTrackingSnippets,
  cleanTracking,
  hasTracking,
  mergeTracking,
  parseTrackingJson,
  productViewPayload,
  sanitizeTrackingPayload,
  trackingErrors,
  type Tracking,
} from './tracking';

function make(overrides: Partial<Tracking> = {}): Tracking {
  return { ...EMPTY_TRACKING, ...overrides };
}

describe('cleanTracking', () => {
  it('giữ ID đúng định dạng, bỏ ID sai', () => {
    const cleaned = cleanTracking({
      metaPixelId: '123456789012345',
      gaMeasurementId: 'g-abc123',
      googleAdsId: 'AW-99887766',
      googleAdsLabel: 'abcDEF_123',
      tiktokPixelId: 'C9ABCD1234EF',
      gtmId: 'gtm-abc12',
    });
    expect(cleaned.metaPixelId).toBe('123456789012345');
    expect(cleaned.gaMeasurementId).toBe('G-ABC123'); // chuẩn hóa hoa
    expect(cleaned.googleAdsId).toBe('AW-99887766');
    expect(cleaned.googleAdsLabel).toBe('abcDEF_123'); // nhãn giữ nguyên hoa thường
    expect(cleaned.tiktokPixelId).toBe('C9ABCD1234EF');
    expect(cleaned.gtmId).toBe('GTM-ABC12');
  });

  it('bỏ giá trị sai và không ném lỗi', () => {
    const cleaned = cleanTracking({ metaPixelId: 'abc', gaMeasurementId: 'UA-123', gtmId: 'x' });
    expect(cleaned.metaPixelId).toBe('');
    expect(cleaned.gaMeasurementId).toBe('');
    expect(cleaned.gtmId).toBe('');
  });

  it('nhãn Google Ads bị bỏ khi không có ID Google Ads', () => {
    const cleaned = cleanTracking({ googleAdsId: '', googleAdsLabel: 'label1' });
    expect(cleaned.googleAdsLabel).toBe('');
  });
});

describe('trackingErrors', () => {
  it('chỉ báo lỗi với giá trị không rỗng và sai định dạng', () => {
    const errors = trackingErrors({ ...EMPTY_TRACKING, metaPixelId: 'abc', gtmId: '' });
    expect(errors.metaPixelId).toBeTruthy();
    expect(errors.gtmId).toBeUndefined();
  });
});

describe('mergeTracking', () => {
  it('landing ghi đè site theo từng field', () => {
    const site = make({ metaPixelId: '111111111', gaMeasurementId: 'G-SITE11' });
    const landing = make({ metaPixelId: '222222222' });
    const merged = mergeTracking(landing, site);
    expect(merged.metaPixelId).toBe('222222222'); // landing thắng
    expect(merged.gaMeasurementId).toBe('G-SITE11'); // trống thì lấy site
  });

  it('cặp Google Ads ID + label đi cùng nguồn', () => {
    const site = make({ googleAdsId: 'AW-111111', googleAdsLabel: 'siteLabel' });
    const landing = make({ googleAdsId: 'AW-222222', googleAdsLabel: 'landLabel' });
    expect(mergeTracking(landing, site).googleAdsLabel).toBe('landLabel');
    expect(mergeTracking(make(), site).googleAdsLabel).toBe('siteLabel');
  });
});

describe('parseTrackingJson', () => {
  it('JSON hỏng trả về cấu hình rỗng', () => {
    expect(parseTrackingJson('{bad')).toEqual(EMPTY_TRACKING);
    expect(hasTracking(parseTrackingJson('{}'))).toBe(false);
  });
});

describe('sanitizeTrackingPayload / productViewPayload', () => {
  it('giữ slug hợp lệ, bỏ id nguy hiểm và quantity sai', () => {
    const safe = sanitizeTrackingPayload({
      amount: 120000.6,
      currency: 'vnd',
      contentName: '  Vòng dâu  ',
      contentType: 'product',
      contents: [
        { id: 'vong-dau-tam', quantity: 2 },
        { id: '<script>', quantity: 1 },
        { id: 'ok', quantity: 0 },
      ],
    });
    expect(safe.amount).toBe(120001);
    expect(safe.currency).toBe('VND');
    expect(safe.contentName).toBe('Vòng dâu');
    expect(safe.contents).toEqual([{ id: 'vong-dau-tam', quantity: 2 }]);
  });

  it('productViewPayload tạo payload chuẩn trang SP', () => {
    expect(productViewPayload({ slug: 'vong-chi-do', name: 'Vòng chỉ đỏ', price: 99000 })).toEqual({
      amount: 99000,
      currency: 'VND',
      contentName: 'Vòng chỉ đỏ',
      contentType: 'product',
      contents: [{ id: 'vong-chi-do', quantity: 1 }],
    });
  });
});

describe('buildTrackingSnippets', () => {
  it('không cấu hình thì không sinh mã nào', () => {
    const snippets = buildTrackingSnippets(EMPTY_TRACKING, 'view');
    expect(snippets.headScripts).toHaveLength(0);
    expect(snippets.headSrc).toHaveLength(0);
    expect(snippets.bodyNoscript).toHaveLength(0);
  });

  it('GTM sinh script head + noscript body', () => {
    const snippets = buildTrackingSnippets(make({ gtmId: 'GTM-ABC12' }), null);
    expect(snippets.headScripts.join('')).toContain('GTM-ABC12');
    expect(snippets.bodyNoscript.join('')).toContain('googletagmanager.com/ns.html?id=GTM-ABC12');
  });

  it('Meta Pixel bắn ViewContent khi view, Lead khi lead; có noscript', () => {
    const view = buildTrackingSnippets(make({ metaPixelId: '123456' }), 'view');
    expect(view.headScripts.join('')).toContain(`fbq('init','123456')`);
    expect(view.headScripts.join('')).toContain('ViewContent');
    const lead = buildTrackingSnippets(make({ metaPixelId: '123456' }), 'lead');
    expect(lead.headScripts.join('')).toContain('Lead');
    expect(view.bodyNoscript.join('')).toContain('facebook.com/tr?id=123456');
  });

  it('ViewContent kèm content_ids / value / currency an toàn (JSON)', () => {
    const view = buildTrackingSnippets(
      make({ metaPixelId: '123456' }),
      'view',
      productViewPayload({ slug: 'vong-dau', name: 'Vòng "dâu" & bé', price: 150000 }),
    );
    const script = view.headScripts.join('');
    expect(script).toContain(`fbq('track','ViewContent',`);
    expect(script).toContain('"content_ids":["vong-dau"]');
    expect(script).toContain('"content_type":"product"');
    expect(script).toContain('"value":150000');
    expect(script).toContain('"currency":"VND"');
    expect(script).toContain('\\"dâu\\"'); // tên có dấu ngoặc được escape trong JSON
  });

  it('Google Ads conversion bắn khi lead và có đủ ID + label', () => {
    const lead = buildTrackingSnippets(make({ googleAdsId: 'AW-123456', googleAdsLabel: 'xyz' }), 'lead');
    expect(lead.headSrc.join('')).toContain('id=AW-123456');
    expect(lead.headScripts.join('')).toContain(`send_to':'AW-123456/xyz'`);
  });

  it('GA4 nạp gtag và config đúng id', () => {
    const snippets = buildTrackingSnippets(make({ gaMeasurementId: 'G-ABC123' }), 'lead');
    expect(snippets.headSrc.join('')).toContain('gtag/js?id=G-ABC123');
    expect(snippets.headScripts.join('')).toContain(`gtag('config','G-ABC123')`);
    expect(snippets.headScripts.join('')).toContain('generate_lead');
  });

  it('TikTok nạp pixel và bắn sự kiện', () => {
    const snippets = buildTrackingSnippets(make({ tiktokPixelId: 'C9ABCD1234EF' }), 'view');
    expect(snippets.headScripts.join('')).toContain(`ttq.load('C9ABCD1234EF')`);
    expect(snippets.headScripts.join('')).toContain('ViewContent');
  });

  it('Meta Pixel bắn Purchase kèm value + contents khi purchase hợp lệ', () => {
    const snippets = buildTrackingSnippets(make({ metaPixelId: '123456' }), 'purchase', {
      amount: 250000,
      currency: 'VND',
      contentName: 'Vòng dâu',
      contentType: 'product',
      contents: [{ id: 'vong-dau', quantity: 2 }],
    });
    const script = snippets.headScripts.join('');
    expect(script).toContain(`fbq('track','Purchase',`);
    expect(script).toContain('"value":250000');
    expect(script).toContain('"currency":"VND"');
    expect(script).toContain('"content_ids":["vong-dau"]');
    expect(script).toContain('"contents":[{"id":"vong-dau","quantity":2}]');
  });

  it('Purchase không có value hợp lệ thì không bắn Purchase (chỉ PageView)', () => {
    const missing = buildTrackingSnippets(make({ metaPixelId: '123456' }), 'purchase', null);
    expect(missing.headScripts.join('')).toContain(`fbq('track','PageView')`);
    expect(missing.headScripts.join('')).not.toContain('Purchase');
    const bad = buildTrackingSnippets(make({ metaPixelId: '123456' }), 'purchase', { amount: -5, currency: 'vnd' });
    expect(bad.headScripts.join('')).not.toContain('Purchase');
  });

  it('Purchase cũng kích hoạt chuyển đổi GA4 + Google Ads kèm value', () => {
    const snippets = buildTrackingSnippets(
      make({ gaMeasurementId: 'G-ABC123', googleAdsId: 'AW-123456', googleAdsLabel: 'xyz' }),
      'purchase',
      { amount: 99000, currency: 'VND' },
    );
    expect(snippets.headScripts.join('')).toContain(`gtag('event','purchase',{value:99000,currency:'VND'})`);
    expect(snippets.headScripts.join('')).toContain(`send_to':'AW-123456/xyz','value':99000,'currency':'VND'`);
  });

  it('Purchase không value thì không bắn GA4 purchase / Ads conversion', () => {
    const snippets = buildTrackingSnippets(
      make({ gaMeasurementId: 'G-ABC123', googleAdsId: 'AW-123456', googleAdsLabel: 'xyz' }),
      'purchase',
      null,
    );
    expect(snippets.headScripts.join('')).not.toContain(`gtag('event','purchase'`);
    expect(snippets.headScripts.join('')).not.toContain(`gtag('event','conversion'`);
  });
});
