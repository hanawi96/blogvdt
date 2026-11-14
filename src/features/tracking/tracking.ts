// Cấu hình theo dõi quảng cáo dùng chung cho toàn site và từng trang đích.
// Nguyên tắc an toàn: chỉ nhận ID đúng định dạng của từng nền tảng rồi TỰ sinh mã chuẩn,
// không bao giờ nhận HTML/script thô từ người dùng (tránh XSS).

import { SLUG_PATTERN } from '../posts/slug';

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

/** Hợp nhất: ưu tiên cấu hình riêng trang, trống thì lấy cấu hình chung (site). */
export function mergeTracking(primary: Tracking, fallback: Tracking): Tracking {
  const merged: Tracking = { ...EMPTY_TRACKING };
  for (const key of TRACKING_KEYS) merged[key] = primary[key] || fallback[key];
  // Giữ cặp Google Ads ID + label cùng một nguồn để nhãn không ghép nhầm với ID khác.
  if (!primary.googleAdsId && fallback.googleAdsId) merged.googleAdsLabel = fallback.googleAdsLabel;
  if (primary.googleAdsId) merged.googleAdsLabel = primary.googleAdsLabel;
  return merged;
}

export type TrackingEvent = 'view' | 'lead' | 'purchase';

/** Một dòng sản phẩm trong contents — id luôn là slug sản phẩm (khớp ViewContent / AddToCart / Purchase). */
export type TrackingContentLine = {
  id: string;
  quantity: number;
};

/**
 * Payload sự kiện ViewContent / Purchase.
 * amount+currency bắt buộc với Purchase; contents dùng slug sản phẩm làm content_ids.
 */
export type TrackingPayload = {
  amount?: number;
  currency?: string;
  contentName?: string;
  contentType?: 'product' | 'product_group';
  contents?: TrackingContentLine[];
};

/** @deprecated Dùng TrackingPayload — giữ alias để tương thích import cũ. */
export type TrackingValue = TrackingPayload;

export type TrackingSnippets = {
  // Chèn trong <head>: nạp thư viện + khởi tạo + bắn sự kiện trang.
  headScripts: string[];
  // Thẻ <script src> nạp bất đồng bộ (GA/GTM).
  headSrc: string[];
  // noscript đặt đầu <body> (GTM) và ảnh fallback Pixel.
  bodyNoscript: string[];
};

type SafePayload = {
  amount: number | null;
  currency: string | null;
  contentName: string | null;
  contentType: 'product' | 'product_group' | null;
  contents: Array<{ id: string; quantity: number }>;
};

function safeContentId(id: string): string | null {
  const text = id.trim();
  if (!SLUG_PATTERN.test(text) || text.length > 180) return null;
  return text;
}

function safeContentName(name: string): string | null {
  const text = name.trim().replace(/\s+/g, ' ').slice(0, 200);
  return text || null;
}

function safeQuantity(value: number): number | null {
  const qty = Math.round(value);
  if (!Number.isFinite(qty) || qty < 1 || qty > 999) return null;
  return qty;
}

function safeMoney(amount: unknown, currency: unknown): { amount: number; currency: string } | null {
  if (typeof amount !== 'number' || typeof currency !== 'string') return null;
  const rounded = Math.round(amount);
  if (!Number.isFinite(rounded) || rounded < 0) return null;
  const code = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return null;
  return { amount: rounded, currency: code };
}

/** Chuẩn hóa payload trước khi nội suy vào script (bỏ field sai / nguy hiểm). */
export function sanitizeTrackingPayload(raw: TrackingPayload | null | undefined): SafePayload {
  const empty: SafePayload = { amount: null, currency: null, contentName: null, contentType: null, contents: [] };
  if (!raw || typeof raw !== 'object') return empty;
  const money = safeMoney(raw.amount, raw.currency);
  const contentName = typeof raw.contentName === 'string' ? safeContentName(raw.contentName) : null;
  const contentType = raw.contentType === 'product' || raw.contentType === 'product_group' ? raw.contentType : null;
  const contents: Array<{ id: string; quantity: number }> = [];
  if (Array.isArray(raw.contents)) {
    for (const line of raw.contents) {
      if (!line || typeof line !== 'object') continue;
      const id = typeof line.id === 'string' ? safeContentId(line.id) : null;
      const quantity = typeof line.quantity === 'number' ? safeQuantity(line.quantity) : null;
      if (!id || quantity === null) continue;
      contents.push({ id, quantity });
    }
  }
  return {
    amount: money?.amount ?? null,
    currency: money?.currency ?? null,
    contentName,
    contentType: contents.length > 0 ? contentType : null,
    contents,
  };
}

/** ViewContent chuẩn cho trang chi tiết sản phẩm — cùng slug với AddToCart / Purchase. */
export function productViewPayload(product: { slug: string; name: string; price: number }): TrackingPayload {
  return {
    amount: product.price,
    currency: 'VND',
    contentName: product.name,
    contentType: 'product',
    contents: [{ id: product.slug, quantity: 1 }],
  };
}

/** Object params Meta/TikTok — JSON.stringify an toàn khi nhúng vào JS. */
function eventParamsObject(payload: SafePayload, requireMoney: boolean): Record<string, unknown> | null {
  if (requireMoney && (payload.amount === null || !payload.currency)) return null;
  const obj: Record<string, unknown> = {};
  if (payload.contents.length > 0) {
    obj.content_ids = payload.contents.map((line) => line.id);
    obj.contents = payload.contents.map((line) => ({ id: line.id, quantity: line.quantity }));
  }
  if (payload.contentType) obj.content_type = payload.contentType;
  if (payload.contentName) obj.content_name = payload.contentName;
  if (payload.amount !== null && payload.currency) {
    obj.value = payload.amount;
    obj.currency = payload.currency;
  }
  return Object.keys(obj).length > 0 ? obj : null;
}

function metaTrackCall(eventName: string, params: Record<string, unknown> | null): string {
  return params ? `fbq('track','${eventName}',${JSON.stringify(params)});` : `fbq('track','${eventName}');`;
}

function tiktokTrackCall(eventName: string, params: Record<string, unknown> | null): string {
  return params ? `ttq.track('${eventName}',${JSON.stringify(params)});` : `ttq.track('${eventName}');`;
}

// Sinh toàn bộ mã nhúng. ID đã qua cleanTracking; payload đã sanitize rồi JSON.stringify.
export function buildTrackingSnippets(
  tracking: Tracking,
  event: TrackingEvent | null,
  trackPayload: TrackingPayload | null = null,
): TrackingSnippets {
  const headScripts: string[] = [];
  const headSrc: string[] = [];
  const bodyNoscript: string[] = [];
  const payload = sanitizeTrackingPayload(trackPayload);
  const purchaseMoney =
    event === 'purchase' && payload.amount !== null && payload.currency
      ? { amount: payload.amount, currency: payload.currency }
      : null;

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
    if (event === 'lead' || (event === 'purchase' && purchaseMoney)) {
      if (tracking.gaMeasurementId) {
        lines.push(
          event === 'purchase' && purchaseMoney
            ? `gtag('event','purchase',{value:${purchaseMoney.amount},currency:'${purchaseMoney.currency}'});`
            : `gtag('event','generate_lead');`,
        );
      }
      if (tracking.googleAdsId && tracking.googleAdsLabel) {
        const extra = event === 'purchase' && purchaseMoney ? `,'value':${purchaseMoney.amount},'currency':'${purchaseMoney.currency}'` : '';
        lines.push(`gtag('event','conversion',{'send_to':'${tracking.googleAdsId}/${tracking.googleAdsLabel}'${extra}});`);
      }
    }
    headScripts.push(lines.join(''));
  }

  // Meta (Facebook) Pixel.
  if (tracking.metaPixelId) {
    let extra = '';
    if (event === 'view') {
      extra = metaTrackCall('ViewContent', eventParamsObject(payload, false));
    } else if (event === 'purchase' && purchaseMoney) {
      // Chỉ bắn Purchase khi có value hợp lệ (đơn thật) — tránh đếm thừa trang cảm ơn không mã đơn.
      extra = metaTrackCall('Purchase', eventParamsObject(payload, true));
    } else if (event === 'lead') {
      extra = metaTrackCall('Lead', null);
    }
    headScripts.push(
      `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${tracking.metaPixelId}');fbq('track','PageView');${extra}`,
    );
    bodyNoscript.push(
      `<img height="1" width="1" style="display:none" alt="" src="https://www.facebook.com/tr?id=${tracking.metaPixelId}&ev=PageView&noscript=1" />`,
    );
  }

  // TikTok Pixel.
  if (tracking.tiktokPixelId) {
    let extra = '';
    if (event === 'view') {
      extra = tiktokTrackCall('ViewContent', eventParamsObject(payload, false));
    } else if (event === 'purchase' && purchaseMoney) {
      extra = tiktokTrackCall('CompletePayment', eventParamsObject(payload, true));
    } else if (event === 'lead') {
      extra = tiktokTrackCall('SubmitForm', null);
    }
    headScripts.push(
      `!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=i;ttq._t=ttq._t||{};ttq._t[e]=+new Date;ttq._o=ttq._o||{};ttq._o[e]=n||{};var o=d.createElement("script");o.type="text/javascript";o.async=!0;o.src=i+"?sdkid="+e+"&lib="+t;var a=d.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};ttq.load('${tracking.tiktokPixelId}');ttq.page();${extra}}(window,document,'ttq');`,
    );
  }

  return { headScripts, headSrc, bodyNoscript };
}
