// Cấu hình theo dõi quảng cáo dùng chung cho toàn site và từng trang đích.
// Nguyên tắc an toàn: chỉ nhận ID đúng định dạng của từng nền tảng rồi TỰ sinh mã chuẩn,
// không bao giờ nhận HTML/script thô từ người dùng (tránh XSS).

export type Tracking = {
  metaPixelId: string;
  gaMeasurementId: string;
  googleAdsId: string;
  googleAdsLabel: string;
  tiktokPixelId: string;
  gtmId: string;
};

export const TRACKING_KEYS = [
  'metaPixelId',
  'gaMeasurementId',
  'googleAdsId',
  'googleAdsLabel',
  'tiktokPixelId',
  'gtmId',
] as const;

export const EMPTY_TRACKING: Tracking = {
  metaPixelId: '',
  gaMeasurementId: '',
  googleAdsId: '',
  googleAdsLabel: '',
  tiktokPixelId: '',
  gtmId: '',
};

// Mỗi ID có một mẫu riêng. Giá trị không khớp bị bỏ (trả rỗng) thay vì làm hỏng cả trang.
const PATTERNS: Record<keyof Tracking, RegExp> = {
  metaPixelId: /^\d{6,20}$/,
  gaMeasurementId: /^G-[A-Z0-9]{4,20}$/,
  googleAdsId: /^AW-\d{6,20}$/,
  googleAdsLabel: /^[A-Za-z0-9_-]{1,40}$/,
  tiktokPixelId: /^[A-Z0-9]{10,30}$/,
  gtmId: /^GTM-[A-Z0-9]{4,12}$/,
};

export const TRACKING_ERRORS: Record<keyof Tracking, string> = {
  metaPixelId: 'ID Meta Pixel chỉ gồm 6–20 chữ số.',
  gaMeasurementId: 'ID Google Analytics (GA4) có dạng G-XXXXXXXXXX.',
  googleAdsId: 'ID Google Ads có dạng AW-123456789.',
  googleAdsLabel: 'Nhãn chuyển đổi Google Ads chỉ gồm chữ, số, gạch ngang và gạch dưới.',
  tiktokPixelId: 'ID TikTok Pixel gồm 10–30 ký tự chữ hoa và số.',
  gtmId: 'ID Google Tag Manager có dạng GTM-XXXXXX.',
};

function normalize(key: keyof Tracking, value: string): string {
  const raw = value.trim();
  if (!raw) return '';
  // Nhãn Google Ads giữ nguyên hoa thường; các ID còn lại chuẩn hóa chữ hoa cho khớp mẫu.
  const candidate = key === 'googleAdsLabel' ? raw : raw.toUpperCase();
  // metaPixelId chỉ gồm chữ số nên không cần đổi hoa; giữ nguyên.
  const text = key === 'metaPixelId' ? raw : candidate;
  return PATTERNS[key].test(text) ? text : '';
}

/** Làm sạch cấu hình từ form hoặc JSON. Field sai định dạng trở thành rỗng. */
export function cleanTracking(raw: Partial<Record<keyof Tracking, unknown>> | null | undefined): Tracking {
  const out: Tracking = { ...EMPTY_TRACKING };
  if (!raw || typeof raw !== 'object') return out;
  for (const key of TRACKING_KEYS) {
    const value = raw[key];
    if (typeof value === 'string') out[key] = normalize(key, value);
  }
  // Nhãn chuyển đổi chỉ có nghĩa khi có ID Google Ads.
  if (!out.googleAdsId) out.googleAdsLabel = '';
  return out;
}

/** Báo lỗi cho các field người dùng nhập sai (rỗng thì bỏ qua). Dùng cho form validate. */
export function trackingErrors(raw: Record<keyof Tracking, string>): Partial<Record<keyof Tracking, string>> {
  const errors: Partial<Record<keyof Tracking, string>> = {};
  for (const key of TRACKING_KEYS) {
    const value = (raw[key] ?? '').trim();
    if (value && normalize(key, value) === '') errors[key] = TRACKING_ERRORS[key];
  }
  return errors;
}

export function parseTrackingJson(json: string): Tracking {
  try {
    return cleanTracking(JSON.parse(json));
  } catch {
    return { ...EMPTY_TRACKING };
  }
}

export function serializeTracking(tracking: Tracking): string {
  return JSON.stringify(tracking);
}

export function hasTracking(tracking: Tracking): boolean {
  return TRACKING_KEYS.some((key) => tracking[key] !== '');
}

/** Hợp nhất: ưu tiên cấu hình riêng (landing), trống thì lấy cấu hình chung (site). */
export function mergeTracking(primary: Tracking, fallback: Tracking): Tracking {
  const merged: Tracking = { ...EMPTY_TRACKING };
  for (const key of TRACKING_KEYS) merged[key] = primary[key] || fallback[key];
  // Giữ cặp Google Ads ID + label cùng một nguồn để nhãn không ghép nhầm với ID khác.
  if (!primary.googleAdsId && fallback.googleAdsId) merged.googleAdsLabel = fallback.googleAdsLabel;
  if (primary.googleAdsId) merged.googleAdsLabel = primary.googleAdsLabel;
  return merged;
}

export type TrackingEvent = 'view' | 'lead';

export type TrackingSnippets = {
  // Chèn trong <head>: nạp thư viện + khởi tạo + bắn sự kiện trang.
  headScripts: string[];
  // Thẻ <script src> nạp bất đồng bộ (GA/GTM).
  headSrc: string[];
  // noscript đặt đầu <body> (GTM) và ảnh fallback Pixel.
  bodyNoscript: string[];
};

// Sinh toàn bộ mã nhúng. ID đã qua cleanTracking nên an toàn để nội suy vào chuỗi script.
export function buildTrackingSnippets(tracking: Tracking, event: TrackingEvent | null): TrackingSnippets {
  const headScripts: string[] = [];
  const headSrc: string[] = [];
  const bodyNoscript: string[] = [];

  // Google Tag Manager — "cửa" để đối tác tự quản mọi thẻ khác.
  if (tracking.gtmId) {
    headScripts.push(
      `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${tracking.gtmId}');`,
    );
    bodyNoscript.push(
      `<iframe src="https://www.googletagmanager.com/ns.html?id=${tracking.gtmId}" height="0" width="0" style="display:none;visibility:hidden"></iframe>`,
    );
  }

  // Google (GA4 và/hoặc Google Ads) dùng chung gtag.
  if (tracking.gaMeasurementId || tracking.googleAdsId) {
    const loaderId = tracking.gaMeasurementId || tracking.googleAdsId;
    headSrc.push(`https://www.googletagmanager.com/gtag/js?id=${loaderId}`);
    const lines = [
      `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());`,
    ];
    if (tracking.gaMeasurementId) lines.push(`gtag('config','${tracking.gaMeasurementId}');`);
    if (tracking.googleAdsId) lines.push(`gtag('config','${tracking.googleAdsId}');`);
    if (event === 'lead') {
      if (tracking.gaMeasurementId) lines.push(`gtag('event','generate_lead');`);
      if (tracking.googleAdsId && tracking.googleAdsLabel) {
        lines.push(`gtag('event','conversion',{'send_to':'${tracking.googleAdsId}/${tracking.googleAdsLabel}'});`);
      }
    }
    headScripts.push(lines.join(''));
  }

  // Meta (Facebook) Pixel.
  if (tracking.metaPixelId) {
    const extra = event === 'view' ? `fbq('track','ViewContent');` : event === 'lead' ? `fbq('track','Lead');` : '';
    headScripts.push(
      `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${tracking.metaPixelId}');fbq('track','PageView');${extra}`,
    );
    bodyNoscript.push(
      `<img height="1" width="1" style="display:none" alt="" src="https://www.facebook.com/tr?id=${tracking.metaPixelId}&ev=PageView&noscript=1" />`,
    );
  }

  // TikTok Pixel.
  if (tracking.tiktokPixelId) {
    const extra = event === 'view' ? `ttq.track('ViewContent');` : event === 'lead' ? `ttq.track('SubmitForm');` : '';
    headScripts.push(
      `!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=i;ttq._t=ttq._t||{};ttq._t[e]=+new Date;ttq._o=ttq._o||{};ttq._o[e]=n||{};var o=d.createElement("script");o.type="text/javascript";o.async=!0;o.src=i+"?sdkid="+e+"&lib="+t;var a=d.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};ttq.load('${tracking.tiktokPixelId}');ttq.page();${extra}}(window,document,'ttq');`,
    );
  }

  return { headScripts, headSrc, bodyNoscript };
}
