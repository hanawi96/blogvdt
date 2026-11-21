const ROOT_ID = 'vdt-pos-overlay-root';
const STORAGE_OPEN = 'overlayOpen';
const STORAGE_WIDTH = 'overlayWidth';
const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 300;
const MAX_WIDTH = 720;
const POS_URL_CACHE_KEY = 'posUrlCached';
/** Khớp SĐT dính liền có 0/+84/84. */
const PHONE_RE = /(?:\+?84|0)(?:3[2-9]|5[2689]|7[06-9]|8[1-9]|9\d)\d{7}/;
/**
 * Quét SĐT trong text tự do: có/không +84|84|0, có khoảng trắng/dấu, hoặc bỏ 0 đầu (9 số).
 * Luôn đưa qua normalizePhone — regex chỉ để bắt ứng viên.
 */
const PHONE_RE_LOOSE_SRC = String.raw`(?:\+?84[\s.\-()]*)?(?:0[\s.\-()]*)?(?:3[2-9]|5[2689]|7[06-9]|8[1-9]|9\d)(?:[\s.\-()]*\d){7}`;

/** @type {Map<string, object>} */
const lookupCache = new Map();
/** @type {Map<string, string>} channel:chatId → phone (cache phiên) */
const chatPhoneCache = new Map();
/** @type {Set<string>} */
const chatLookupPending = new Set();
/** Đã tra map DB một lần cho hội thoại này (tránh nháy status khi MutationObserver chạy). */
const chatMapTried = new Set();
/** Đã lưu SĐT→chat thành công trong phiên. */
const chatPhonePersisted = new Set();
/** Đang/đã gửi lưu (tránh spam); xóa khi đổi chat hoặc lưu lỗi để thử lại. */
const chatPhoneSaveAttempted = new Set();
/** @type {object | null} */
let activeCustomer = null;
/** @type {{ lineIndex: number, mode: 'weight' | 'qty' | 'name', extraOpen?: boolean } | null} */
let customerEditUi = null;
let customerSaving = false;
let customerDeleteConfirm = false;
let customerCanDelete = false;
let lastConvId = '';
let lastPhone = '';
let lastName = '';
/** Giữ chatId Zalo ổn định trong lúc DOM list ảo hóa / class selected nhấp nháy. */
let stickyZaloChatId = '';
let stickyZaloNameKey = '';
let debounceTimer = 0;
let addrScanTimer = 0;
let posOrigin = '';
let posReady = false;
let loginUrl = '';
/** @type {object[]} */
let pendingPosMessages = [];
/** URL POS đã biết — tránh chờ storage mỗi lần gắn iframe. */
let cachedPosUrl = '';
/** @type {Promise<{ ok?: boolean, posUrl?: string, loginUrl?: string }> | null} */
let syncInflight = null;
/** Content script cũ còn sống sau Reload extension — dừng chrome.* để tránh Uncaught. */
let extensionDead = false;
/** @type {MutationObserver | null} */
let chatObserver = null;
/** Muốn mở sidebar sau khi panel sẵn sàng (tránh khung trống). */
let desiredOpen = true;
let panelReady = false;
let bootRevealTimer = 0;
/** Hội thoại có SĐT nhưng chưa có đơn (Pancake + Zalo). */
/** @type {{ count: number, items: Array<{ channel: string, chatId: string, phone: string, updatedAt: number }> }} */
let pendingChatState = { count: 0, items: [] };
let pendingPanelOpen = false;
/** @type {Promise<void> | null} */
let pendingFetchInflight = null;
let pendingRefreshTimer = 0;
let listPhoneScanTimer = 0;
/** Sàn tối thiểu giữa 2 lần kéo badge pending — giảm load D1. */
const PENDING_MIN_INTERVAL_MS = 5000;
let lastPendingFetchAt = 0;
/** Doanh thu / số đơn tạo hôm nay (header). */
let todayStatsState = { orders: 0, revenue: 0, profit: 0, ready: false };
/** @type {Promise<void> | null} */
let todayStatsFetchInflight = null;
let todayStatsRefreshTimer = 0;
let todayStatsPollTimer = 0;
const TODAY_STATS_POLL_MS = 60_000;

function isExtensionAlive() {
  if (extensionDead) return false;
  try {
    if (!chrome?.runtime?.id) {
      extensionDead = true;
      return false;
    }
    return true;
  } catch {
    extensionDead = true;
    return false;
  }
}

function markExtensionDead() {
  if (extensionDead) return;
  extensionDead = true;
  window.clearTimeout(debounceTimer);
  window.clearTimeout(addrScanTimer);
  window.clearTimeout(bootRevealTimer);
  window.clearTimeout(pendingRefreshTimer);
  window.clearTimeout(listPhoneScanTimer);
  window.clearTimeout(todayStatsRefreshTimer);
  window.clearTimeout(todayStatsPollTimer);
  try {
    chatObserver?.disconnect();
  } catch {
    /* ignore */
  }
  chatObserver = null;
  // Gỡ shell cũ — tránh tiếp tục kéo/resize/gọi chrome.* sau Reload.
  try {
    document.getElementById(ROOT_ID)?.remove();
  } catch {
    /* ignore */
  }
  try {
    clearHostLayoutInset();
  } catch {
    /* ignore */
  }
}

function isContextInvalidatedError(error) {
  const msg = String(error?.message || error || '');
  return /invalidated|extension context/i.test(msg);
}

/** Nuốt Uncaught "Extension context invalidated" từ content script cũ sau Reload. */
function installContextGuards() {
  window.addEventListener(
    'error',
    (event) => {
      if (!isContextInvalidatedError(event.error || event.message)) return;
      markExtensionDead();
      event.preventDefault();
    },
    true,
  );
  window.addEventListener('unhandledrejection', (event) => {
    if (!isContextInvalidatedError(event.reason)) return;
    markExtensionDead();
    event.preventDefault();
  });
}

function runtimeLastErrorMessage() {
  try {
    return chrome.runtime.lastError?.message || '';
  } catch (error) {
    markExtensionDead();
    return error instanceof Error ? error.message : 'Extension context invalidated.';
  }
}

/** @param {object} message */
function runtimeSend(message) {
  return new Promise((resolve) => {
    if (!isExtensionAlive()) {
      resolve(null);
      return;
    }
    try {
      const maybePromise = chrome.runtime.sendMessage(message);
      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise
          .then((result) => resolve(result ?? null))
          .catch((error) => {
            if (isContextInvalidatedError(error)) markExtensionDead();
            resolve(null);
          });
        return;
      }
      // Fallback callback (một số bản Chrome).
      chrome.runtime.sendMessage(message, (result) => {
        try {
          const err = runtimeLastErrorMessage();
          if (err) {
            if (/invalidated|extension context/i.test(err)) markExtensionDead();
            resolve(null);
            return;
          }
          resolve(result ?? null);
        } catch (error) {
          if (isContextInvalidatedError(error)) markExtensionDead();
          resolve(null);
        }
      });
    } catch (error) {
      if (isContextInvalidatedError(error)) markExtensionDead();
      else markExtensionDead();
      resolve(null);
    }
  });
}

/** @param {'local' | 'sync'} area @param {string[]} keys */
function storageGet(area, keys) {
  return new Promise((resolve) => {
    if (!isExtensionAlive()) {
      resolve({});
      return;
    }
    try {
      const result = chrome.storage[area].get(keys);
      Promise.resolve(result)
        .then((stored) => resolve(stored || {}))
        .catch((error) => {
          if (isContextInvalidatedError(error)) markExtensionDead();
          else markExtensionDead();
          resolve({});
        });
    } catch (error) {
      markExtensionDead();
      resolve({});
    }
  });
}

/** @param {'local' | 'sync'} area @param {Record<string, unknown>} values */
function storageSet(area, values) {
  if (!isExtensionAlive()) return Promise.resolve();
  try {
    const result = chrome.storage[area].set(values);
    return Promise.resolve(result).catch((error) => {
      if (isContextInvalidatedError(error)) markExtensionDead();
      else markExtensionDead();
    });
  } catch {
    markExtensionDead();
    return Promise.resolve();
  }
}

function extensionUrl(path) {
  if (!isExtensionAlive()) return '';
  try {
    return chrome.runtime.getURL(path);
  } catch {
    markExtensionDead();
    return '';
  }
}

/** Bắt đầu sync session + lấy URL ngay khi script chạy (song song với dựng UI). */
function prefetchPosUrl() {
  return runtimeSend({ type: 'vdt-get-pos-url' }).then((message) => {
    const url = typeof message?.posUrl === 'string' ? message.posUrl : '';
    if (url) cachedPosUrl = url;
    return cachedPosUrl;
  });
}

function syncSession(force = false) {
  if (force) syncInflight = null;
  if (!syncInflight) {
    syncInflight = runtimeSend({ type: 'vdt-sync-session', pageUrl: location.href }).then((message) => {
      if (message?.posUrl) cachedPosUrl = message.posUrl;
      return message || { ok: false };
    });
  }
  return syncInflight;
}

void prefetchPosUrl();
void syncSession();
void runtimeSend({ type: 'vdt-pos-bootstrap-warm' });
void storageGet('local', [POS_URL_CACHE_KEY]).then((stored) => {
  if (!cachedPosUrl && typeof stored?.[POS_URL_CACHE_KEY] === 'string' && stored[POS_URL_CACHE_KEY]) {
    cachedPosUrl = stored[POS_URL_CACHE_KEY];
  }
});

function revealOverlayIfReady() {
  if (!panelReady) return;
  const root = document.getElementById(ROOT_ID);
  if (!(root instanceof HTMLElement)) return;
  root.classList.remove('is-booting');
  root.classList.toggle('is-collapsed', !desiredOpen);
  applyHostLayoutInset(root);
  window.clearTimeout(bootRevealTimer);
}

function rememberPosUrl(url) {
  if (!url) return;
  cachedPosUrl = url;
  void storageSet('local', { [POS_URL_CACHE_KEY]: url });
}

function sameFrameUrl(frame, frameUrl) {
  if (!frame?.src) return false;
  try {
    return frame.src === frameUrl || new URL(frame.src).href === new URL(frameUrl).href;
  } catch {
    return frame.src === frameUrl;
  }
}

function clampWidth(value) {
  const max = Math.min(MAX_WIDTH, Math.floor(window.innerWidth * 0.85));
  const min = Math.min(MIN_WIDTH, max);
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_WIDTH;
  return Math.min(max, Math.max(min, n));
}

function applyWidth(root, width) {
  root.style.setProperty('--vdt-width', `${clampWidth(width)}px`);
  applyHostLayoutInset(root);
}

/** Chiều rộng sidebar đang chiếm trên host (0 nếu thu / đang boot). */
function currentOverlayInset(root = document.getElementById(ROOT_ID)) {
  if (!(root instanceof HTMLElement)) return 0;
  if (root.classList.contains('is-collapsed') || root.classList.contains('is-booting')) return 0;
  return clampWidth(parseFloat(getComputedStyle(root).getPropertyValue('--vdt-width')) || DEFAULT_WIDTH);
}

/**
 * Zalo: thu hẹp #chatViewContainer (margin-right) khi sidebar mở
 * để tin nhắn không bị che.
 */
function applyHostLayoutInset(root = document.getElementById(ROOT_ID)) {
  if (!isZalo()) return;
  const px = currentOverlayInset(root);
  const html = document.documentElement;
  html.style.setProperty('--vdt-host-inset', `${px}px`);
  html.classList.toggle('vdt-zalo-inset', px > 0);
  if (root instanceof HTMLElement) {
    html.classList.toggle('vdt-zalo-resizing', root.classList.contains('is-resizing'));
  } else {
    html.classList.remove('vdt-zalo-resizing');
  }
}

function clearHostLayoutInset() {
  const html = document.documentElement;
  html.classList.remove('vdt-zalo-inset', 'vdt-zalo-resizing');
  html.style.removeProperty('--vdt-host-inset');
}

/** Chuẩn hóa mobile VN → 0xxxxxxxxx. Khớp logic src/features/orders/order.ts. */
function normalizePhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('84') && digits.length >= 11) digits = digits.slice(2);
  const bodyOk = /^(?:3[2-9]|5[2689]|7[06-9]|8[1-9]|9\d)\d{7}$/;
  if (digits.length === 9 && bodyOk.test(digits)) digits = `0${digits}`;
  if (digits.length === 10 && digits.startsWith('0') && bodyOk.test(digits.slice(1))) return digits;
  return null;
}

/**
 * Từ chối SĐT nằm trong dãy số dài hơn (vd. STK 19034579387036 → không bắt 0903457938).
 * @param {string} text
 * @param {number} index
 * @param {number} length
 */
function isDigitBoundedPhoneMatch(text, index, length) {
  if (index < 0 || length < 1) return false;
  if (index > 0 && /\d/.test(text[index - 1] || '')) return false;
  const end = index + length;
  if (end < text.length && /\d/.test(text[end] || '')) return false;
  return true;
}

/**
 * Bắt SĐT trong text tự do — có boundary chữ số để tránh STK/mã dài.
 * @param {string} text
 * @returns {string[]}
 */
function extractPhonesFromText(text) {
  /** @type {string[]} */
  const phones = [];
  const raw = String(text || '');
  if (!raw || raw.length > 4000) return phones;

  const collect = (source) => {
    for (const match of raw.matchAll(new RegExp(source, 'g'))) {
      const chunk = match[0];
      const index = match.index ?? -1;
      if (!isDigitBoundedPhoneMatch(raw, index, chunk.length)) continue;
      const phone = normalizePhone(chunk);
      if (phone && !phones.includes(phone)) phones.push(phone);
    }
  };

  collect(PHONE_RE_LOOSE_SRC);
  if (!phones.length) collect(PHONE_RE.source);
  return phones;
}

function money(amount) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(amount);
}

function dayLabel(timestamp) {
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit' }).format(new Date(timestamp));
}

function pageHost() {
  return location.hostname.replace(/^www\./i, '').toLowerCase();
}

function isPancake() {
  return pageHost() === 'pancake.vn' || pageHost().endsWith('.pancake.vn');
}

function isZalo() {
  return pageHost() === 'chat.zalo.me' || pageHost().endsWith('.zalo.me');
}

/** Chỉ hiện sidebar trên page inbox đã chọn — không gắn mọi trang pancake.vn. */
function isAllowedOverlayPage() {
  const host = pageHost();
  if (host === 'chat.zalo.me') return true;
  if (host === 'pancake.vn') return /^\/vongdautambyvui(?:\/|$)/i.test(location.pathname);
  return false;
}

function tearDownOverlayShell() {
  try {
    document.getElementById(ROOT_ID)?.remove();
  } catch {
    /* ignore */
  }
  try {
    clearHostLayoutInset();
  } catch {
    /* ignore */
  }
}

/** Chiều cao header cố định Pancake — sidebar bắt đầu dưới thanh tím. */
function pancakeHeaderOffset() {
  if (!isPancake()) return 0;
  const selectors = [
    'header.ant-layout-header',
    '.ant-layout-header',
    '#root > div > header',
    'header',
    '[class*="AppHeader"]',
    '[class*="app-header"]',
    '[class*="TopNav"]',
    '[class*="top-nav"]',
  ];
  let best = 0;
  for (const selector of selectors) {
    let nodes;
    try {
      nodes = document.querySelectorAll(selector);
    } catch {
      continue;
    }
    for (const el of nodes) {
      if (!(el instanceof HTMLElement)) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (style.position !== 'fixed' && style.position !== 'sticky') continue;
      const rect = el.getBoundingClientRect();
      if (rect.top > 4 || rect.height < 36 || rect.height > 96) continue;
      if (rect.width < Math.min(window.innerWidth * 0.45, 360)) continue;
      best = Math.max(best, Math.round(rect.bottom));
    }
    if (best > 0) break;
  }
  // Fallback thanh tím Pancake ~48–56px nếu DOM chưa kịp render.
  return best > 0 ? best : 56;
}

function applyHostChromeOffset(root = document.getElementById(ROOT_ID)) {
  if (!(root instanceof HTMLElement)) return;
  root.style.setProperty('--vdt-top', `${pancakeHeaderOffset()}px`);
}

function cleanName(raw) {
  const text = String(raw || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, 80) : null;
}

function chatChannel() {
  if (isPancake()) return 'pancake';
  if (isZalo()) return 'zalo';
  return '';
}

function chatCacheKey(channel, chatId) {
  return `${channel}:${chatId}`;
}

/** Id hội thoại Zalo ổn định (anim-data-id), không phải `zalo:tên hiển thị`. */
function isStableZaloChatId(id) {
  const value = String(id || '').trim();
  if (!value || /^zalo:/i.test(value)) return false;
  return /^[ge]?\d{8,}$/i.test(value);
}

function readZaloHeaderName() {
  const title =
    document.querySelector('.threadChat__title .header-title') ||
    document.querySelector('.threadChat .header-title') ||
    document.querySelector('.threadChat__title');
  return cleanName(title?.textContent);
}

/** Id ổn định từ list Zalo (`anim-data-id` trên `.msg-item`). */
function readZaloListChatId() {
  const selected =
    document.querySelector(
      '#conversationList .msg-item.selected, #conversationList .msg-item.active, #conversationList .msg-item.is-active, #conversationList .msg-item[aria-selected="true"], #conversationlist .msg-item.selected, #conversationlist .msg-item.active, #conversationlist .msg-item.is-active, #conversationlist .msg-item[aria-selected="true"]',
    ) ||
    document.querySelector('.msg-item.selected, .msg-item.active, .msg-item.is-active, .msg-item[aria-selected="true"]') ||
    document.querySelector('#conversationList .conv-item.selected, #conversationList .conv-item.active, #conversationlist .conv-item.selected, #conversationlist .conv-item.active, .conv-item.selected, .conv-item.active')?.closest('.msg-item');
  if (selected instanceof HTMLElement) {
    const anim = selected.getAttribute('anim-data-id');
    if (isStableZaloChatId(anim)) return String(anim).slice(0, 191);
  }

  // Zalo list thường không có .selected — khớp tên header với dòng trong #conversationList.
  const headerName = readZaloHeaderName();
  if (!headerName) return '';
  const items = document.querySelectorAll('#conversationList .msg-item, #conversationlist .msg-item');
  for (const item of items) {
    if (!(item instanceof HTMLElement)) continue;
    const anim = item.getAttribute('anim-data-id');
    if (!isStableZaloChatId(anim)) continue;
    const titleEl =
      item.querySelector('.conv-item-title, .truncate, [class*="conv-item"] [class*="name"], [class*="title"]') || item;
    const rowName = cleanName(titleEl.textContent || '');
    if (!rowName) continue;
    if (rowName === headerName || rowName.startsWith(headerName) || headerName.startsWith(rowName.split(/\s+/).slice(0, 4).join(' '))) {
      return String(anim).slice(0, 191);
    }
  }
  // Khớp lỏng: tên nằm ở đầu text của row (trước tin nhắn cuối).
  for (const item of items) {
    if (!(item instanceof HTMLElement)) continue;
    const anim = item.getAttribute('anim-data-id');
    if (!isStableZaloChatId(anim)) continue;
    const rowText = cleanName(item.textContent || '');
    if (rowText.startsWith(headerName)) return String(anim).slice(0, 191);
  }
  return '';
}

function readZaloThreadChatId() {
  const thread =
    document.querySelector('.threadChat[id]') ||
    document.querySelector('[data-id].threadChat') ||
    document.querySelector('.main-chat-container [id]');
  if (!(thread instanceof HTMLElement)) return '';
  const id = thread.id || thread.getAttribute('data-id') || '';
  return isStableZaloChatId(id) ? String(id).slice(0, 191) : '';
}

function readZaloNameChatId() {
  const name = readZaloHeaderName();
  return name ? `zalo:${name}` : '';
}

/** Ưu tiên anim-data-id; `zalo:tên` chỉ để TRA map cũ (không ghi mới). */
function zaloChatIdCandidates() {
  const ids = [];
  const push = (id) => {
    const value = String(id || '').trim().slice(0, 191);
    if (value && !ids.includes(value)) ids.push(value);
  };
  push(readZaloListChatId());
  push(readZaloThreadChatId());
  push(readZaloNameChatId());
  return ids;
}

function selectedConversationId() {
  if (isPancake()) {
    const item =
      document.querySelector('#conversationCol .conversation-list-item.selected') ||
      document.querySelector('.conversation-list-item.selected');
    if (item instanceof HTMLElement) {
      // Dòng list gắn id trực tiếp: pageId_conversationId
      const fromDom =
        item.id ||
        item.closest('[id]')?.id ||
        item.getAttribute('data-id') ||
        item.getAttribute('data-conversation-id') ||
        item.getAttribute('data-cid');
      if (fromDom) return String(fromDom).slice(0, 191);
    }
    const fromPath = location.pathname.match(/\/(?:conversation|conversations|inbox)\/([^/?#]+)/i);
    if (fromPath?.[1]) return decodeURIComponent(fromPath[1]).slice(0, 191);
    const fromQuery = location.href.match(/[?&#](?:c|cid|conversation_id|conversationId)=([^&#]+)/i);
    if (fromQuery?.[1]) return decodeURIComponent(fromQuery[1]).slice(0, 191);
    return '';
  }
  if (isZalo()) {
    const nameKey = readZaloNameChatId();
    const listId = readZaloListChatId();
    const threadId = readZaloThreadChatId();
    const stable = [listId, threadId].find((id) => isStableZaloChatId(id)) || '';

    // Có id thật (g123…) → luôn dùng; nâng cấp nếu trước đó chỉ có zalo:tên.
    if (stable) {
      stickyZaloChatId = stable;
      stickyZaloNameKey = nameKey;
      return stable;
    }

    if (stickyZaloChatId && isStableZaloChatId(stickyZaloChatId) && nameKey && nameKey === stickyZaloNameKey) {
      return stickyZaloChatId;
    }

    // Tạm dùng tên khi list ảo hóa chưa có row — sẽ thay khi đọc được anim-data-id.
    const fallback = nameKey || '';
    stickyZaloChatId = fallback;
    stickyZaloNameKey = nameKey;
    return fallback;
  }
  return '';
}

/**
 * @param {string} channel
 * @param {string} chatId
 * @param {string} phone
 * @param {string} [_name]
 * @param {{ fromList?: boolean }} [opts] fromList: chỉ lưu đúng chatId (không gắn id chat đang mở).
 */
function persistChatPhone(channel, chatId, phone, _name, opts = {}) {
  if (!channel || !chatId || !phone) return;
  const fromList = Boolean(opts.fromList);
  // Zalo: chỉ lưu id chat ổn định — không ghi alias `zalo:tên`.
  let primaryId = chatId;
  if (channel === 'zalo') {
    if (!isStableZaloChatId(primaryId)) {
      if (fromList) return;
      primaryId = zaloChatIdCandidates().find((id) => isStableZaloChatId(id)) || '';
    }
    if (!primaryId) return;
  }
  const gate = chatCacheKey(channel, primaryId);
  const cached = chatPhoneCache.get(gate);
  // Đã lưu đúng số này — thôi. Số khác (vd. trước nhầm shiper) thì cho ghi đè.
  if (chatPhonePersisted.has(gate) && cached === phone) {
    rememberChatPhone(channel, primaryId, phone);
    return;
  }
  if (cached && cached !== phone) {
    chatPhonePersisted.delete(gate);
    chatPhoneSaveAttempted.delete(gate);
  }
  if (chatPhoneSaveAttempted.has(gate) && cached === phone) return;
  chatPhoneSaveAttempted.add(gate);

  const saveOne = (id) => {
    const keyId = String(id || '').trim().slice(0, 191);
    if (!keyId) return;
    if (channel === 'zalo' && !isStableZaloChatId(keyId)) return;
    const key = chatCacheKey(channel, keyId);
    rememberChatPhone(channel, keyId, phone);
    if (chatPhonePersisted.has(key) && chatPhoneCache.get(key) === phone) return;
    chatPhoneSaveAttempted.add(key);
    void runtimeSend({ type: 'vdt-save-chat-phone', channel, chatId: keyId, phone }).then((result) => {
      if (result?.ok) {
        chatPhonePersisted.add(key);
        chatPhonePersisted.add(gate);
        schedulePendingRefresh(500);
        return;
      }
      // Lỗi mạng/CSRF/403 — cho phép thử lại khi mở lại chat.
      chatPhoneSaveAttempted.delete(key);
      chatPhoneSaveAttempted.delete(gate);
    });
  };
  saveOne(primaryId);
  // Chỉ khi đang ở chat mở mới đồng bộ thêm candidate id — tránh gắn nhầm khi quét list.
  if (!fromList && channel === 'zalo') {
    for (const id of zaloChatIdCandidates()) {
      if (isStableZaloChatId(id)) saveOne(id);
    }
  }
}

function pancakeListItemChatId(item) {
  if (!(item instanceof HTMLElement)) return '';
  const row = item.classList.contains('conversation-list-item')
    ? item
    : item.closest('.conversation-list-item') || item;
  const fromDom =
    row.id ||
    row.getAttribute('data-id') ||
    row.getAttribute('data-conversation-id') ||
    row.getAttribute('data-cid') ||
    row.closest('[id]')?.id;
  return fromDom ? String(fromDom).slice(0, 191) : '';
}

/** Lấy SĐT hiện trong một dòng list (preview / tag) — không mở chat. */
function phoneFromListItem(item) {
  if (!(item instanceof HTMLElement)) return null;
  // Pancake: ưu tiên tag SĐT trên dòng hội thoại nếu có.
  const tag =
    item.querySelector('.cross-channel-phone__number, .cross-channel-phone.phone-tag, .cross-channel-phone copy, [class*="phone-tag"]') ||
    null;
  if (tag) {
    const fromTag = normalizePhone(tag.textContent || '');
    if (fromTag) return fromTag;
  }
  const phones = extractPhonesFromNode(item);
  if (!phones.length) return null;
  // Một số trong preview thường là SĐT khách vừa gửi.
  return phones[phones.length - 1] || phones[0] || null;
}

/**
 * Quét list hội thoại đang hiện — lưu chat→SĐT để badge «chưa lưu» không cần mở từng box.
 * @returns {number} số mapping phát hiện trên DOM
 */
function scanConversationListPhones() {
  const channel = chatChannel();
  if (!channel) return 0;
  /** @type {Array<{ chatId: string, phone: string }>} */
  const rows = [];

  if (channel === 'pancake') {
    const items = document.querySelectorAll('.conversation-list-item, .body-conver-item');
    for (const item of items) {
      if (!(item instanceof HTMLElement)) continue;
      if (item.closest(`#${ROOT_ID}`)) continue;
      const chatId = pancakeListItemChatId(item);
      if (!chatId) continue;
      const phone = phoneFromListItem(item);
      if (!phone) continue;
      rows.push({ chatId, phone });
    }
  } else if (channel === 'zalo') {
    const items = document.querySelectorAll('#conversationList .msg-item, #conversationlist .msg-item');
    for (const item of items) {
      if (!(item instanceof HTMLElement)) continue;
      const anim = item.getAttribute('anim-data-id');
      if (!isStableZaloChatId(anim)) continue;
      const phone = phoneFromListItem(item);
      if (!phone) continue;
      rows.push({ chatId: String(anim).slice(0, 191), phone });
    }
  }

  let touched = 0;
  for (const row of rows) {
    const key = chatCacheKey(channel, row.chatId);
    if (chatPhonePersisted.has(key) && chatPhoneCache.get(key) === row.phone) continue;
    persistChatPhone(channel, row.chatId, row.phone, '', { fromList: true });
    touched += 1;
  }
  return rows.length;
}

function scheduleListPhoneScan(delayMs = 700) {
  if (!isExtensionAlive()) return;
  window.clearTimeout(listPhoneScanTimer);
  listPhoneScanTimer = window.setTimeout(() => {
    listPhoneScanTimer = 0;
    if (!isExtensionAlive()) return;
    try {
      scanConversationListPhones();
    } catch {
      /* DOM race */
    }
    // Luôn kéo lại badge từ DB — kể cả khi chưa mở chat nào.
    schedulePendingRefresh(250);
  }, delayMs);
}

function readChatName() {
  if (isPancake()) {
    const el =
      document.querySelector('#pageCustomer .customer-name') ||
      document.querySelector('.customer-info-wrapper .customer-name') ||
      document.querySelector('span.copyable-text.customer-name');
    return cleanName(el?.textContent);
  }
  if (isZalo()) {
    const el =
      document.querySelector('.threadChat__title .header-title') ||
      document.querySelector('.threadChat .header-title');
    return cleanName(el?.textContent);
  }
  return null;
}

function readPancakePhone() {
  if (!isPancake()) return null;
  const copy =
    document.querySelector('.cross-channel-phone__number copy') ||
    document.querySelector('.cross-channel-phone.phone-tag copy') ||
    document.querySelector('.cross-channel-phone copy');
  if (copy?.textContent) {
    const phone = normalizePhone(copy.textContent);
    if (phone) return phone;
  }
  const nodes = document.querySelectorAll(
    '.cross-channel-phone__number, .cross-channel-phone.phone-tag, .cross-channel-phone.phone-tag-trusted',
  );
  for (const node of nodes) {
    const phone = extractPhonesFromText(node.textContent || '')[0];
    if (phone) return phone;
  }
  return null;
}

const MESSAGE_BUBBLE_SELECTOR = [
  '[class*="message-content"]',
  '[class*="msg-content"]',
  '[class*="message-text"]',
  '[class*="msg-text"]',
  '[class*="bubble-text"]',
  '[class*="chat-content"]',
  '.text-message',
  '.message-body',
  '[data-contents]',
].join(', ');

const CHAT_LIST_SEL =
  '#conversationList, #conversationlist, .conversation-list, .conversation-list-item, .body-conver-item, [class*="conversation-list"], .msg-item, .left-nav';

/** Tin mình gửi (bubble xanh) — Zalo: SentMsg / me / outgoing. */
function isZaloOutgoingMessage(node) {
  if (!(node instanceof Element)) return false;
  if (node.closest('[data-id="div_SentMsg_Text"], [data-id*="SentMsg"], [data-id*="SendMsg"]')) return true;
  const bubble = node.closest('.chat-message, [data-component="bubble-message"], .chat-item');
  if (!bubble) return false;
  if (bubble.querySelector('[data-id="div_SentMsg_Text"], [data-id*="SentMsg"], [data-id*="SendMsg"]')) return true;
  return /\b(me|mine|sent|outgoing|self)\b/i.test(bubble.className);
}

/**
 * Tin khách gửi (bubble trắng) — Zalo: data-id div_ReceivedMsg_Text.
 * Chỉ tin cậy nhãn ReceivedMsg; không đoán theo màu CSS.
 */
function isZaloCustomerMessage(node) {
  if (!(node instanceof Element)) return false;
  if (isZaloOutgoingMessage(node)) return false;
  if (node.closest('[data-id="div_ReceivedMsg_Text"], [data-id*="ReceivedMsg"]')) return true;
  const bubble = node.closest('.chat-message, [data-component="bubble-message"], .chat-item');
  return Boolean(bubble?.querySelector('[data-id="div_ReceivedMsg_Text"], [data-id*="ReceivedMsg"]'));
}

function extractPhonesFromNode(node) {
  /** @type {string[]} */
  const phones = [];
  if (!(node instanceof HTMLElement)) return phones;
  const text = node.innerText || node.textContent || '';
  for (const phone of extractPhonesFromText(text)) {
    if (!phones.includes(phone)) phones.push(phone);
  }
  for (const link of node.querySelectorAll('a[href^="tel:"], a[href^="callto:"]')) {
    const href = link.getAttribute('href') || '';
    const phone = normalizePhone(href.replace(/^(tel|callto):/i, ''));
    if (phone && !phones.includes(phone)) phones.push(phone);
  }
  return phones;
}

/** Tin nhân viên / page gửi trên Pancake — bỏ khi lấy SĐT hoặc gắn pin. */
function isPancakeOutgoingMessage(node) {
  if (!(node instanceof Element)) return false;
  let el = node instanceof HTMLElement ? node : null;
  for (let depth = 0; el && depth < 8; depth += 1) {
    const bits = [
      el.className || '',
      el.getAttribute('data-type') || '',
      el.getAttribute('data-from') || '',
      el.getAttribute('data-sender') || '',
      el.getAttribute('data-direction') || '',
      el.getAttribute('data-is-page') || '',
      el.getAttribute('data-from-page') || '',
    ].join(' ');
    if (
      /\b(me|mine|sent|outgoing|self|from[_-]?me|is[_-]?me|own[_-]?message|msg[_-]?out|message[_-]?out|from[_-]?page|is[_-]?page|page[_-]?message|staff|agent)\b/i.test(
        bits,
      )
    ) {
      return true;
    }
    el = el.parentElement;
  }
  return false;
}

/**
 * Tin căn phải trong khung chat = tin mình gửi (Zalo xanh / Pancake page).
 * Dùng khi class/data-id không đủ — tránh gắn pin vào tin shop.
 */
function isVisuallyOutgoingMessage(node) {
  if (!(node instanceof HTMLElement)) return false;
  const bubble =
    node.closest(
      '.chat-message, [data-component="bubble-message"], [class*="message"], [class*="bubble"], [class*="chat-item"], [class*="msg-item"]',
    ) || node;
  if (!(bubble instanceof HTMLElement)) return false;
  const pane =
    bubble.closest(
      '[class*="message-list"], [class*="msg-list"], [class*="chat-content"], [class*="conversation-content"], [class*="thread"], [class*="chat-window"], main, [role="log"]',
    ) || bubble.offsetParent;
  if (!(pane instanceof HTMLElement)) return false;
  const b = bubble.getBoundingClientRect();
  const p = pane.getBoundingClientRect();
  if (b.width < 12 || p.width < 80) return false;
  const distLeft = b.left - p.left;
  const distRight = p.right - b.right;
  // Căn phải rõ (lề phải nhỏ hơn lề trái đáng kể).
  return distRight + 24 < distLeft;
}

/** Chỉ tin khách mới gắn pin / double-click nhận địa chỉ. */
function isCustomerAddressMessage(node) {
  if (isVisuallyOutgoingMessage(node)) return false;
  if (isZalo()) return isZaloCustomerMessage(node);
  if (isPancake()) return !isPancakeOutgoingMessage(node);
  return true;
}

/** SĐT trong bubble hội thoại đang mở — ưu tiên tin khách; lấy số xuất hiện sau cùng (mới nhất). */
function readPhoneFromVisibleMessages() {
  let found = null;

  if (isZalo()) {
    // Text / danh thiếp / contact card khách — không quét bubble xanh.
    const nodes = document.querySelectorAll(
      [
        '[data-id="div_ReceivedMsg_Text"]',
        '[data-id*="ReceivedMsg_Text"]',
        '[data-id*="ReceivedMsg"]',
        '[data-id*="ReceivedContact"]',
        '[data-id*="ContactMsg"]',
        '.chat-message[data-component="bubble-message"]',
        '[data-component="bubble-message"]',
      ].join(', '),
    );
    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) continue;
      if (node.closest(`#${ROOT_ID}`)) continue;
      if (node.closest(CHAT_LIST_SEL)) continue;
      if (isZaloOutgoingMessage(node)) continue;
      const isReceivedLabel = /Received/i.test(node.getAttribute('data-id') || '');
      if (!isReceivedLabel && !isZaloCustomerMessage(node)) continue;
      for (const phone of extractPhonesFromNode(node)) found = phone;
    }
    return found;
  }

  for (const node of document.querySelectorAll(MESSAGE_BUBBLE_SELECTOR)) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.closest(`#${ROOT_ID}`)) continue;
    if (node.closest(CHAT_LIST_SEL)) continue;
    if (isPancakeOutgoingMessage(node)) continue;
    for (const phone of extractPhonesFromNode(node)) found = phone;
  }
  return found;
}

/**
 * SĐT đáng tin cho header / tạo đơn:
 * 1) Số trong tin nhắn khách đang hiện (ưu tiên — khách gửi số mới thì nhận số mới)
 * 2) Tag SĐT Pancake (dự phòng khi chưa có số trong bubble)
 * Không dùng SĐT bắt từ JSON API toàn cục (dễ lấy nhầm hội thoại khác).
 */
function readTrustedPhone() {
  return readPhoneFromVisibleMessages() || readPancakePhone();
}

function rememberChatPhone(channel, chatId, phone) {
  if (!channel || !chatId || !phone) return;
  chatPhoneCache.set(chatCacheKey(channel, chatId), phone);
}

function postCustomerFill({ phone, name, channel, chatId }) {
  postToPos({
    type: 'vdt-fill-customer',
    phone: phone || undefined,
    name: name || undefined,
    channel: channel || undefined,
    chatId: chatId || undefined,
  });
}

function markChatMapTried(channel, chatId) {
  if (!channel || !chatId) return;
  chatMapTried.add(chatCacheKey(channel, chatId));
  if (channel === 'zalo') {
    for (const id of zaloChatIdCandidates()) chatMapTried.add(chatCacheKey(channel, id));
  }
}

function applyMappedPhone(channel, chatId, phone, name) {
  const normalized = normalizePhone(phone);
  if (!normalized) return;
  markChatMapTried(channel, chatId);
  persistChatPhone(channel, chatId, normalized, name || '');
  postCustomerFill({ phone: normalized, name: name || '', channel, chatId });
  lastPhone = normalized;
  lastConvId = chatId;
  // Giống Pancake: mở chat → tra đơn/SP theo SĐT đã gắn, dù tin SĐT phải cuộn mới thấy.
  requestLookup(normalized, chatId, name || '');
}

/** Tra map chat→SĐT đúng một lần khi mở hội thoại — không lặp theo DOM mutation. */
function requestChatPhoneMap(channel, chatId, name) {
  if (!channel || !chatId) return;
  const triedKey = chatCacheKey(channel, chatId);
  if (chatMapTried.has(triedKey) || chatLookupPending.has(triedKey)) return;

  const candidates =
    channel === 'zalo' ? zaloChatIdCandidates() : [chatId];
  const ids = candidates.length > 0 ? candidates : [chatId];

  for (const id of ids) {
    const cached = chatPhoneCache.get(chatCacheKey(channel, id));
    if (cached) {
      markChatMapTried(channel, chatId);
      applyMappedPhone(channel, chatId, cached, name || '');
      return;
    }
  }

  chatLookupPending.add(triedKey);
  markChatMapTried(channel, chatId);

  const root = ensureRoot();
  setCustomerStatus(root, 'Đang lấy SĐT đã lưu…');

  void (async () => {
    try {
      for (const id of ids) {
        if (!isExtensionAlive()) return;
        if (selectedConversationId() !== chatId) return;
        const result = await runtimeSend({ type: 'vdt-lookup-chat-phone', channel, chatId: id });
        if (!result || !isExtensionAlive()) return;
        if (result.error === 'auth') {
          loginUrl = result.loginUrl || loginUrl;
          setAuthBanner(root, true);
          setCustomerStatus(root, 'Cần đăng nhập admin để tra đơn.');
          return;
        }
        if (!result.ok || !result.found || !result.phone) continue;
        if (selectedConversationId() !== chatId) return;
        applyMappedPhone(channel, chatId, result.phone, name || '');
        return;
      }
      if (selectedConversationId() === chatId) {
        setCustomerStatus(root, 'Chưa gắn SĐT — cuộn tin nhắn có số hoặc nhập tay.');
      }
    } finally {
      chatLookupPending.delete(triedKey);
    }
  })();
}

function bindResize(root) {
  const handle = root.querySelector('.vdt-resizer');
  if (!(handle instanceof HTMLElement) || handle.dataset.bound === '1') return;
  handle.dataset.bound = '1';

  let dragging = false;
  let startX = 0;
  let startWidth = DEFAULT_WIDTH;
  let latest = DEFAULT_WIDTH;
  let raf = 0;

  const paint = () => {
    raf = 0;
    applyWidth(root, latest);
  };

  const onMove = (event) => {
    if (!dragging) return;
    latest = clampWidth(startWidth + (startX - event.clientX));
    if (!raf) raf = requestAnimationFrame(paint);
  };

  const onUp = (event) => {
    if (!dragging) return;
    dragging = false;
    root.classList.remove('is-resizing');
    applyHostLayoutInset(root);
    handle.releasePointerCapture?.(event.pointerId);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    applyWidth(root, latest);
    if (isExtensionAlive()) void storageSet('sync', { [STORAGE_WIDTH]: clampWidth(latest) });
  };

  handle.addEventListener('pointerdown', (event) => {
    if (!isExtensionAlive()) return;
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.preventDefault();
    dragging = true;
    startX = event.clientX;
    startWidth = clampWidth(parseFloat(getComputedStyle(root).getPropertyValue('--vdt-width')) || DEFAULT_WIDTH);
    latest = startWidth;
    root.classList.add('is-resizing');
    applyHostLayoutInset(root);
    handle.setPointerCapture?.(event.pointerId);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
}

function customerBox(root) {
  return root.querySelector('[data-vdt-customer]');
}

function authBox(root) {
  return root.querySelector('[data-vdt-auth]');
}

function setAuthBanner(root, show, message = '') {
  const box = authBox(root);
  if (!(box instanceof HTMLElement)) return;
  box.hidden = !show;
  const text = box.querySelector('[data-vdt-auth-text]');
  if (text) text.textContent = message || 'Chưa đăng nhập admin. Đăng nhập trên trang quản trị một lần — sidebar dùng chung phiên.';
}

function setCustomerStatus(root, text) {
  const box = customerBox(root);
  if (!(box instanceof HTMLElement)) return;
  const next = String(text || '');
  // Tránh nháy DOM khi sync lặp cùng một câu status.
  if (!box.hidden && box.dataset.state === 'status' && box.dataset.statusText === next) return;
  box.hidden = false;
  box.dataset.state = 'status';
  box.dataset.statusText = next;
  box.innerHTML = `<p class="vdt-customer-status">${escapeHtml(next)}</p>`;
}

function setNoOrderStatus(root, phone) {
  const box = customerBox(root);
  if (!(box instanceof HTMLElement)) return;
  const next = `Chưa có đơn với ${phone}`;
  if (!box.hidden && box.dataset.state === 'no-order' && box.dataset.statusText === next) return;
  box.hidden = false;
  box.dataset.state = 'no-order';
  box.dataset.statusText = next;
  box.innerHTML = `
    <div class="vdt-pending-banner">
      <p class="vdt-customer-status">${escapeHtml(next)}</p>
      <button type="button" class="vdt-pending-banner-skip" data-vdt-pending-dismiss-current title="Bỏ qua" aria-label="Bỏ qua">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    </div>`;
}

function channelLabel(channel) {
  if (channel === 'zalo') return 'Zalo';
  if (channel === 'pancake') return 'Pancake';
  return String(channel || '');
}

function formatPendingAge(updatedAt) {
  const ms = Date.now() - Number(updatedAt || 0);
  if (!Number.isFinite(ms) || ms < 0) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'vừa xong';
  if (mins < 60) return `${mins} phút`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ`;
  return `${Math.floor(hours / 24)} ngày`;
}

function schedulePendingRefresh(delayMs = 400) {
  if (!isExtensionAlive()) return;
  window.clearTimeout(pendingRefreshTimer);
  const elapsed = Date.now() - lastPendingFetchAt;
  const wait = Math.max(delayMs, PENDING_MIN_INTERVAL_MS - elapsed);
  pendingRefreshTimer = window.setTimeout(() => {
    pendingRefreshTimer = 0;
    void refreshPendingChats();
  }, Math.max(0, wait));
}

function refreshPendingChats() {
  if (!isExtensionAlive()) return Promise.resolve();
  if (pendingFetchInflight) return pendingFetchInflight;
  lastPendingFetchAt = Date.now();
  pendingFetchInflight = runtimeSend({ type: 'vdt-pending-chat-phones' })
    .then((result) => {
      pendingFetchInflight = null;
      if (!isExtensionAlive()) return;
      if (!result?.ok) return;
      pendingChatState = {
        count: Number(result.count) || 0,
        items: Array.isArray(result.items) ? result.items : [],
      };
      renderPendingUi(ensureRoot());
    })
    .catch(() => {
      pendingFetchInflight = null;
    });
  return pendingFetchInflight;
}

function formatTodayMoney(amount) {
  const n = Math.round(Number(amount) || 0);
  const text = `${new Intl.NumberFormat('vi-VN').format(Math.abs(n))}đ`;
  return n < 0 ? `−${text}` : text;
}

function renderTodayStatsUi(root = ensureRoot()) {
  const el = root.querySelector('[data-vdt-today-stats]');
  if (!(el instanceof HTMLElement)) return;
  if (!todayStatsState.ready) {
    el.hidden = true;
    el.replaceChildren();
    el.removeAttribute('title');
    return;
  }
  const orders = Math.max(0, Math.floor(Number(todayStatsState.orders) || 0));
  const revenue = formatTodayMoney(Math.max(0, Number(todayStatsState.revenue) || 0));
  const profitNum = Math.round(Number(todayStatsState.profit) || 0);
  const profit = formatTodayMoney(profitNum);
  const profitTone = profitNum < 0 ? 'neg' : profitNum > 0 ? 'pos' : 'zero';
  el.hidden = false;
  el.title = `Hôm nay: ${revenue} doanh thu / ${profit} lãi / ${orders} đơn (không tính hủy · gửi bù; lãi trên đơn có đủ giá vốn)`;
  el.replaceChildren();
  const mkMetric = (kind, text, tone) => {
    const span = document.createElement('span');
    span.className = 'vdt-today-metric';
    span.dataset.kind = kind;
    if (tone) span.dataset.tone = tone;
    span.textContent = text;
    return span;
  };
  const mkSep = () => {
    const sep = document.createElement('span');
    sep.className = 'vdt-today-sep';
    sep.setAttribute('aria-hidden', 'true');
    sep.textContent = '/';
    return sep;
  };
  el.append(
    mkMetric('revenue', revenue),
    mkSep(),
    mkMetric('profit', profit, profitTone),
    mkSep(),
    mkMetric('orders', `${orders} đơn`),
  );
}

function scheduleTodayStatsRefresh(delayMs = 300) {
  if (!isExtensionAlive()) return;
  window.clearTimeout(todayStatsRefreshTimer);
  todayStatsRefreshTimer = window.setTimeout(() => {
    todayStatsRefreshTimer = 0;
    void refreshTodayStats();
  }, Math.max(0, delayMs));
}

function refreshTodayStats() {
  if (!isExtensionAlive()) return Promise.resolve();
  if (todayStatsFetchInflight) return todayStatsFetchInflight;
  todayStatsFetchInflight = runtimeSend({ type: 'vdt-pos-today-stats' })
    .then((result) => {
      todayStatsFetchInflight = null;
      if (!isExtensionAlive()) return;
      if (!result?.ok) {
        if (result?.error === 'auth') {
          todayStatsState = { orders: 0, revenue: 0, profit: 0, ready: false };
          renderTodayStatsUi();
        }
        return;
      }
      todayStatsState = {
        orders: Number(result.orders) || 0,
        revenue: Number(result.revenue) || 0,
        profit: Number(result.profit) || 0,
        ready: true,
      };
      renderTodayStatsUi();
    })
    .catch(() => {
      todayStatsFetchInflight = null;
    });
  return todayStatsFetchInflight;
}

function syncTodayStatsPolling() {
  window.clearTimeout(todayStatsPollTimer);
  todayStatsPollTimer = 0;
  if (!isExtensionAlive() || !desiredOpen) return;
  todayStatsPollTimer = window.setTimeout(() => {
    todayStatsPollTimer = 0;
    if (!isExtensionAlive() || !desiredOpen) return;
    void refreshTodayStats().finally(() => syncTodayStatsPolling());
  }, TODAY_STATS_POLL_MS);
}

function renderPendingUi(root) {
  const badge = root.querySelector('[data-vdt-pending-badge]');
  const countEl = root.querySelector('[data-vdt-pending-count]');
  const panel = root.querySelector('[data-vdt-pending-panel]');
  const list = root.querySelector('[data-vdt-pending-list]');
  if (!(badge instanceof HTMLElement) || !(panel instanceof HTMLElement) || !(list instanceof HTMLElement)) {
    return;
  }

  const count = pendingChatState.count;
  const pageChannel = chatChannel();
  const items = [...pendingChatState.items].sort((a, b) => {
    const aSame = a.channel === pageChannel ? 0 : 1;
    const bSame = b.channel === pageChannel ? 0 : 1;
    if (aSame !== bSame) return aSame - bSame;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });

  const shown = count > 99 ? '99+' : String(count);
  if (countEl) countEl.textContent = shown;
  badge.title = count > 0 ? `${shown} đơn chưa lưu` : 'SĐT chưa có đơn';
  badge.hidden = count <= 0;
  badge.setAttribute('aria-expanded', pendingPanelOpen && count > 0 ? 'true' : 'false');
  panel.hidden = !pendingPanelOpen || count <= 0;

  if (count <= 0) {
    pendingPanelOpen = false;
    list.innerHTML = '';
    return;
  }

  list.innerHTML = items
    .map((item) => {
      const same = item.channel === pageChannel;
      const age = formatPendingAge(item.updatedAt);
      const meta = `${channelLabel(item.channel)}${age ? ` · ${age}` : ''}${same ? '' : ' · mở tab khác'}`;
      return `<li class="vdt-pending-item${same ? ' is-here' : ''}" data-vdt-pending-item data-channel="${escapeAttr(item.channel)}" data-chat-id="${escapeAttr(item.chatId)}" data-phone="${escapeAttr(item.phone)}">
        <button type="button" class="vdt-pending-open" data-vdt-pending-open>
          <span class="vdt-pending-phone">${escapeHtml(item.phone)}</span>
          <span class="vdt-pending-meta">${escapeHtml(meta)}</span>
        </button>
        <button type="button" class="vdt-pending-copy" data-vdt-pending-copy title="Sao chép SĐT" aria-label="Sao chép SĐT">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/></svg>
        </button>
        <button type="button" class="vdt-pending-skip" data-vdt-pending-dismiss title="Bỏ qua" aria-label="Bỏ qua">×</button>
      </li>`;
    })
    .join('');
}

function cssEscape(value) {
  const raw = String(value || '');
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(raw);
  return raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function waitMs(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function setPancakeComposerText(textarea, text) {
  if (!(textarea instanceof HTMLTextAreaElement) && !(textarea instanceof HTMLInputElement)) return;
  const next = String(text || '');
  const last = textarea.value;
  const proto = textarea instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const native = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  native?.call(textarea, next);
  textarea.value = next;
  try {
    const tracker = /** @type {{ setValue?: (v: string) => void } | undefined} */ (textarea)._valueTracker;
    tracker?.setValue?.(last);
  } catch {
    /* ignore */
  }
  textarea.dispatchEvent(
    new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertFromPaste', data: next }),
  );
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
}

function pancakeReplyComposer() {
  return (
    document.querySelector('#replyBoxComposer') ||
    document.querySelector('.reply-box__text-area textarea') ||
    document.querySelector('#messageCol textarea') ||
    document.querySelector('textarea[placeholder*="Trả lời" i]')
  );
}

function pancakeSendButton(nearComposer) {
  const scopes = [];
  if (nearComposer instanceof Element) {
    scopes.push(
      nearComposer.closest('.reply-box') ||
        nearComposer.closest('#messageCol') ||
        nearComposer.closest('[class*="reply"]') ||
        nearComposer.parentElement,
    );
  }
  scopes.push(document.querySelector('#messageCol'), document);

  for (const scope of scopes) {
    if (!(scope instanceof Element) && scope !== document) continue;
    const root = scope instanceof Element ? scope : document;
    const exact =
      root.querySelector('[aria-label="Gửi tin nhắn"]') ||
      root.querySelector('.reply-box.btn[role="button"]') ||
      root.querySelector('.reply-box-actions-container [role="button"]');
    if (exact instanceof HTMLElement) return exact;

    for (const el of root.querySelectorAll('[role="button"][aria-label], button[aria-label], span[aria-label]')) {
      if (!(el instanceof HTMLElement)) continue;
      const label = el.getAttribute('aria-label') || '';
      if (/gửi\s*tin\s*nhắn/i.test(label) || /^gửi$/i.test(label.trim())) return el;
    }
  }
  return null;
}

function pressComposerEnter(composer, { ctrl = false } = {}) {
  if (!(composer instanceof HTMLElement)) return;
  const opts = {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true,
    ctrlKey: Boolean(ctrl),
    metaKey: Boolean(ctrl),
  };
  composer.dispatchEvent(new KeyboardEvent('keydown', opts));
  composer.dispatchEvent(new KeyboardEvent('keypress', opts));
  composer.dispatchEvent(new KeyboardEvent('keyup', opts));
}

function activatePancakeSend(el) {
  if (!(el instanceof HTMLElement)) return false;
  try {
    el.focus?.();
  } catch {
    /* ignore */
  }
  try {
    el.click();
  } catch {
    /* ignore */
  }
  for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
    try {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, buttons: 1 }));
    } catch {
      /* ignore */
    }
  }
  return true;
}

/**
 * Điền ô trả lời Pancake + bấm gửi lần lượt từng tin.
 * @param {string[]} messages
 */
async function sendPancakeConfirmMessages(messages) {
  if (!isPancake()) {
    return { ok: false, error: 'Chỉ gửi xác nhận trên Pancake (hội thoại đang mở).' };
  }
  const list = Array.isArray(messages) ? messages.filter((item) => String(item || '').trim()) : [];
  if (!list.length) return { ok: false, error: 'Không có nội dung tin xác nhận.' };

  const composer = pancakeReplyComposer();
  if (!(composer instanceof HTMLTextAreaElement) && !(composer instanceof HTMLInputElement)) {
    return { ok: false, error: 'Không thấy ô trả lời chat. Mở hội thoại khách trước.' };
  }

  for (let i = 0; i < list.length; i += 1) {
    const text = String(list[i] || '').trim();
    if (!text) continue;
    composer.focus();
    setPancakeComposerText(composer, text);
    await waitMs(180);

    // Nút gửi đôi khi chỉ hiện / enable sau khi có nội dung.
    let sendBtn = pancakeSendButton(composer);
    for (let tryFind = 0; !sendBtn && tryFind < 6; tryFind += 1) {
      await waitMs(100);
      sendBtn = pancakeSendButton(composer);
    }

    let sent = false;
    if (sendBtn instanceof HTMLElement) {
      sent = activatePancakeSend(sendBtn);
      await waitMs(200);
      // Nếu text vẫn còn → thử Enter.
      if (String(composer.value || '').trim().length > 0) {
        pressComposerEnter(composer, { ctrl: false });
        await waitMs(120);
        pressComposerEnter(composer, { ctrl: true });
      }
    } else {
      pressComposerEnter(composer, { ctrl: false });
      await waitMs(120);
      pressComposerEnter(composer, { ctrl: true });
      sent = true;
    }

    if (!sent && !(sendBtn instanceof HTMLElement)) {
      return { ok: false, error: 'Không thấy nút Gửi tin nhắn trên Pancake.' };
    }

    // Đợi Pancake gửi xong / xóa composer trước tin tiếp.
    for (let wait = 0; wait < 10; wait += 1) {
      await waitMs(120);
      if (!String(composer.value || '').trim()) break;
    }
    await waitMs(i === list.length - 1 ? 200 : 500);
  }
  return { ok: true };
}

function zaloRichInput() {
  return (
    document.querySelector('#richInput') ||
    document.querySelector('#chat-input-container-id [contenteditable="true"]') ||
    document.querySelector('.chat-input-content [contenteditable="true"].rich-input') ||
    document.querySelector('.chat-input-container [contenteditable="true"]')
  );
}

function zaloSendButton(nearComposer) {
  const scopes = [];
  if (nearComposer instanceof Element) {
    scopes.push(
      nearComposer.closest('#chat-input-container-id') ||
        nearComposer.closest('.chat-input-container') ||
        nearComposer.closest('[class*="chat-input"]') ||
        nearComposer.parentElement,
    );
  }
  scopes.push(document.querySelector('#chat-input-container-id'), document);

  for (const scope of scopes) {
    if (!(scope instanceof Element) && scope !== document) continue;
    const root = scope instanceof Element ? scope : document;
    const exact =
      root.querySelector('.send-msg-btn:not([data-disabled])') ||
      root.querySelector('.send-msg-btn') ||
      root.querySelector('.chat-box-input-button.send-msg-btn') ||
      root.querySelector('[data-translate-title="STR_SEND"]') ||
      root.querySelector('[title="Gửi"].chat-box-input-button');
    if (exact instanceof HTMLElement) return exact;

    for (const el of root.querySelectorAll('[title], [data-translate-title], button, [role="button"]')) {
      if (!(el instanceof HTMLElement)) continue;
      const title = el.getAttribute('title') || '';
      const key = el.getAttribute('data-translate-title') || '';
      if (key === 'STR_SEND' || /^gửi$/i.test(title.trim())) return el;
    }
  }
  return null;
}

function zaloComposerText(composer) {
  if (!(composer instanceof HTMLElement)) return '';
  return String(composer.innerText || composer.textContent || '')
    .replace(/\u200b/g, '')
    .trim();
}

/** Đặt caret an toàn trong composer — tránh addRange khi node đã detach. */
function placeZaloCaret(composer, { selectAll = false } = {}) {
  if (!(composer instanceof HTMLElement) || !composer.isConnected) return false;
  try {
    const selection = window.getSelection();
    if (!selection) return false;
    const range = document.createRange();
    if (selectAll && composer.childNodes.length > 0) {
      range.selectNodeContents(composer);
    } else if (composer.childNodes.length > 0) {
      range.selectNodeContents(composer);
      range.collapse(false);
    } else {
      range.setStart(composer, 0);
      range.collapse(true);
    }
    if (!composer.isConnected) return false;
    if (!(range.startContainer instanceof Node) || !range.startContainer.isConnected) return false;
    if (!(range.endContainer instanceof Node) || !range.endContainer.isConnected) return false;
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  } catch {
    return false;
  }
}

function fillZaloComposerDom(composer, text) {
  if (!(composer instanceof HTMLElement) || !composer.isConnected) return;
  const lines = String(text || '').split(/\r?\n/);
  try {
    composer.replaceChildren();
    lines.forEach((lineText, index) => {
      const line = document.createElement('div');
      if (index === 0) line.id = 'input_line_0';
      if (lineText) line.textContent = lineText;
      else line.appendChild(document.createElement('br'));
      composer.appendChild(line);
    });
  } catch {
    try {
      composer.textContent = String(text || '');
    } catch {
      /* ignore */
    }
  }
  for (const type of ['beforeinput', 'input']) {
    try {
      composer.dispatchEvent(
        new InputEvent(type, {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: String(text || ''),
        }),
      );
    } catch {
      if (type === 'input') composer.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  try {
    composer.dispatchEvent(new Event('change', { bubbles: true }));
  } catch {
    /* ignore */
  }
}

/** Điền #richInput (contenteditable) để Zalo nhận input. */
function setZaloComposerText(composer, text) {
  // Luôn lấy node đang gắn document — Zalo hay re-render #richInput.
  const live =
    (composer instanceof HTMLElement && composer.isConnected && composer) ||
    (zaloRichInput() instanceof HTMLElement ? zaloRichInput() : null);
  if (!(live instanceof HTMLElement) || !live.isConnected) return;

  const next = String(text || '');
  try {
    live.focus();
  } catch {
    /* ignore */
  }

  let inserted = false;
  // 1) Chọn hết + insertText (chỉ khi caret đặt được trong document).
  if (placeZaloCaret(live, { selectAll: true })) {
    try {
      inserted = Boolean(document.execCommand('insertText', false, next));
    } catch {
      inserted = false;
    }
  }

  // 2) Paste text/plain nếu insertText không ăn.
  if ((!inserted || zaloComposerText(live) !== next.trim()) && live.isConnected) {
    try {
      placeZaloCaret(live, { selectAll: true });
      const dt = new DataTransfer();
      dt.setData('text/plain', next);
      live.dispatchEvent(
        new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dt,
        }),
      );
      inserted = zaloComposerText(live) === next.trim() || zaloComposerText(live).includes(next.slice(0, 24));
    } catch {
      inserted = false;
    }
  }

  // 3) Fallback DOM + input events — không dùng Selection/addRange.
  if (!inserted || zaloComposerText(live) !== next.trim()) {
    fillZaloComposerDom(live, next);
  }
}

function activateZaloSend(el) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.hasAttribute('data-disabled')) {
    // Thử bỏ disabled nếu Zalo chỉ gắn attribute UI.
    try {
      el.removeAttribute('data-disabled');
    } catch {
      /* ignore */
    }
  }
  try {
    el.focus?.();
  } catch {
    /* ignore */
  }
  try {
    el.click();
  } catch {
    /* ignore */
  }
  for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
    try {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, buttons: 1 }));
    } catch {
      /* ignore */
    }
  }
  return true;
}

/**
 * Điền ô chat Zalo (#richInput) + bấm .send-msg-btn lần lượt từng tin.
 * @param {string[]} messages
 */
async function sendZaloConfirmMessages(messages) {
  if (!isZalo()) {
    return { ok: false, error: 'Chỉ gửi xác nhận trên Zalo (hội thoại đang mở).' };
  }
  const list = Array.isArray(messages) ? messages.filter((item) => String(item || '').trim()) : [];
  if (!list.length) return { ok: false, error: 'Không có nội dung tin xác nhận.' };

  if (!(zaloRichInput() instanceof HTMLElement)) {
    return { ok: false, error: 'Không thấy ô nhập tin Zalo. Mở hội thoại khách trước.' };
  }

  for (let i = 0; i < list.length; i += 1) {
    const text = String(list[i] || '').trim();
    if (!text) continue;
    const composer = zaloRichInput();
    if (!(composer instanceof HTMLElement)) {
      return { ok: false, error: 'Không thấy ô nhập tin Zalo. Mở hội thoại khách trước.' };
    }
    setZaloComposerText(composer, text);
    await waitMs(200);

    const live = zaloRichInput() instanceof HTMLElement ? zaloRichInput() : composer;
    let sendBtn = zaloSendButton(live);
    for (let tryFind = 0; tryFind < 8; tryFind += 1) {
      if (sendBtn instanceof HTMLElement && !sendBtn.hasAttribute('data-disabled')) break;
      await waitMs(100);
      sendBtn = zaloSendButton(zaloRichInput() || live);
    }

    let sent = false;
    const active = zaloRichInput() instanceof HTMLElement ? zaloRichInput() : live;
    if (sendBtn instanceof HTMLElement) {
      sent = activateZaloSend(sendBtn);
      await waitMs(220);
      if (zaloComposerText(active).length > 0) {
        pressComposerEnter(active, { ctrl: false });
        await waitMs(120);
        pressComposerEnter(active, { ctrl: true });
      }
    } else {
      pressComposerEnter(active, { ctrl: false });
      await waitMs(120);
      pressComposerEnter(active, { ctrl: true });
      sent = true;
    }

    if (!sent && !(sendBtn instanceof HTMLElement)) {
      return { ok: false, error: 'Không thấy nút Gửi trên Zalo.' };
    }

    for (let wait = 0; wait < 12; wait += 1) {
      await waitMs(120);
      const box = zaloRichInput() instanceof HTMLElement ? zaloRichInput() : active;
      if (!zaloComposerText(box)) break;
    }
    await waitMs(i === list.length - 1 ? 200 : 550);
  }
  return { ok: true };
}

/** @param {string[]} messages */
async function sendConfirmMessages(messages) {
  if (isPancake()) return sendPancakeConfirmMessages(messages);
  if (isZalo()) return sendZaloConfirmMessages(messages);
  return { ok: false, error: 'Chỉ gửi xác nhận khi đang mở hội thoại Pancake hoặc Zalo.' };
}

function asPancakeListItem(el) {
  if (!(el instanceof HTMLElement)) return null;
  if (el.closest('#messageCol') && !el.closest('#conversationCol')) return null;
  if (el.classList.contains('conversation-list-item')) return el;
  return el.closest('.conversation-list-item');
}

function activateConversationEl(el) {
  if (!(el instanceof HTMLElement)) return false;
  const clickable =
    asPancakeListItem(el) ||
    el.closest('.msg-item, .conv-item, .body-conver-item') ||
    el.querySelector('.conversation-list-item, .msg-item, .conv-item') ||
    el;
  if (!(clickable instanceof HTMLElement)) return false;
  try {
    clickable.scrollIntoView({ block: 'center', inline: 'nearest' });
  } catch {
    /* ignore */
  }
  // Pancake (React): ưu tiên click thật + chuỗi pointer/mouse.
  try {
    clickable.click();
  } catch {
    /* ignore */
  }
  for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
    try {
      clickable.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, view: window, buttons: 1 }),
      );
    } catch {
      /* ignore */
    }
  }
  const body = clickable.querySelector('.body-conver-item, .media-body, .name-module');
  if (body instanceof HTMLElement && body !== clickable) {
    try {
      body.click();
    } catch {
      /* ignore */
    }
  }
  return true;
}

function pancakeConversationScope() {
  return document.querySelector('#conversationCol') || document;
}

function findPancakeConversationEl(chatId, phone) {
  const scope = pancakeConversationScope();
  const root = scope instanceof Element ? scope : document;
  const id = String(chatId || '').trim();
  if (id) {
    // Id dạng 1103…_4119… — getElementById an toàn hơn CSS #id (bắt đầu bằng số).
    const byId = document.getElementById(id);
    const safeAttr = id.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const candidates = [
      asPancakeListItem(byId),
      byId,
      root.querySelector(`.conversation-list-item[id="${safeAttr}"]`),
      root.querySelector(`[class*="list_tags_conv_${safeAttr}"]`)?.closest('.conversation-list-item'),
      root.querySelector(`[id="${safeAttr}"].conversation-list-item`),
      root.querySelector(`[id="${safeAttr}"]`),
    ];
    for (const el of candidates) {
      const item = asPancakeListItem(el) || (el instanceof HTMLElement ? el : null);
      if (item) return item;
    }
  }
  const want = normalizePhone(phone || '');
  if (!want) return null;
  for (const item of root.querySelectorAll('.conversation-list-item')) {
    if (!(item instanceof HTMLElement)) continue;
    if (item.closest(`#${ROOT_ID}`)) continue;
    // Ưu tiên snippet preview; fallback toàn dòng.
    const snippet = item.querySelector('.snippet-wrap, .name-module');
    const phones = snippet ? extractPhonesFromNode(snippet) : [];
    const all = phones.length ? phones : extractPhonesFromNode(item);
    if (all.includes(want)) return item;
  }
  return null;
}

function findZaloConversationEl(chatId, phone) {
  const id = String(chatId || '').trim();
  if (id && isStableZaloChatId(id)) {
    const byAnim = document.querySelector(`.msg-item[anim-data-id="${cssEscape(id)}"]`);
    if (byAnim instanceof HTMLElement) return byAnim;
  }
  const want = normalizePhone(phone || '');
  if (!want) return null;
  for (const item of document.querySelectorAll('#conversationList .msg-item, #conversationlist .msg-item')) {
    if (!(item instanceof HTMLElement)) continue;
    const phones = extractPhonesFromNode(item);
    if (phones.includes(want)) return item;
  }
  return null;
}

function findConversationEl(channel, chatId, phone) {
  if (channel === 'pancake' && isPancake()) return findPancakeConversationEl(chatId, phone);
  if (channel === 'zalo' && isZalo()) return findZaloConversationEl(chatId, phone);
  return null;
}

function conversationListScroller(channel) {
  if (channel === 'zalo') {
    return (
      document.querySelector('#conversationList') ||
      document.querySelector('#conversationlist') ||
      document.querySelector('.msg-item')?.closest('[style*="overflow"], .ReactVirtualized, [class*="virtual"]')
    );
  }
  if (channel === 'pancake') {
    const col = document.querySelector('#conversationCol');
    // Pancake dùng Ant Design virtual list — phải cuộn đúng .rc-virtual-list-holder.
    const holder =
      col?.querySelector('.rc-virtual-list-holder') ||
      document.querySelector('#conversationCol .rc-virtual-list-holder') ||
      col?.querySelector('.rc-virtual-list') ||
      null;
    if (holder instanceof HTMLElement) return holder;
    return (
      document.querySelector('.conversation-list') ||
      document.querySelector('[class*="conversation-list"]') ||
      document.querySelector('.conversation-list-item')?.parentElement ||
      col
    );
  }
  return null;
}

function vdtOpenChatDebug(...args) {
  try {
    if (localStorage.getItem('vdtDebugOpenChat') === '1') {
      console.info('[vdt-open-chat]', ...args);
    }
  } catch {
    /* ignore */
  }
}

function pancakeSearchInput() {
  const col = document.querySelector('#conversationCol');
  if (!(col instanceof HTMLElement)) return null;
  const input =
    col.querySelector('input[placeholder*="Tìm kiếm" i]') ||
    col.querySelector('input[placeholder*="Tìm" i]') ||
    col.querySelector('input[type="search"]') ||
    col.querySelector('input[placeholder*="Search" i]') ||
    col.querySelector('.ant-input-affix-wrapper input') ||
    col.querySelector('input.ant-input') ||
    col.querySelector('input[type="text"]');
  return input instanceof HTMLInputElement ? input : null;
}

function setPancakeSearchValue(input, value) {
  if (!(input instanceof HTMLInputElement)) return;
  input.focus();
  const next = String(value ?? '');
  const last = input.value;
  // React controlled input: _valueTracker + native setter.
  const native = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  native?.call(input, next);
  input.value = next;
  try {
    const tracker = /** @type {{ setValue?: (v: string) => void } | undefined} */ (input)._valueTracker;
    tracker?.setValue?.(last);
  } catch {
    /* ignore */
  }
  input.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertFromPaste',
      data: next,
    }),
  );
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: next.slice(-1) || '0', code: 'Digit0' }));
}

function visiblePancakeListItems() {
  const col = document.querySelector('#conversationCol') || document;
  return [...col.querySelectorAll('.conversation-list-item')].filter(
    (el) => el instanceof HTMLElement && !el.closest(`#${ROOT_ID}`),
  );
}

/**
 * Chọn đúng dòng sau khi (có thể) đã search.
 * Ưu tiên: exact id → còn đúng 1 dòng trong list → đúng 1 dòng có SĐT.
 */
function resolvePancakeTarget(chatId, phone, { afterSearch = false } = {}) {
  const id = String(chatId || '').trim();
  const want = normalizePhone(phone || '');
  const items = visiblePancakeListItems();

  if (id) {
    const byId =
      asPancakeListItem(document.getElementById(id)) || items.find((item) => item.id === id) || null;
    if (byId) {
      vdtOpenChatDebug('resolve: exact id', id);
      return byId;
    }
  }

  if (afterSearch && items.length === 1) {
    vdtOpenChatDebug('resolve: single row after search', items[0].id, 'wantId', id || null);
    return items[0];
  }

  if (!want) {
    vdtOpenChatDebug('resolve: no phone and id missing', { id, visible: items.length });
    return null;
  }

  const phoneHits = items.filter((item) => extractPhonesFromNode(item).includes(want));
  if (phoneHits.length === 1) {
    vdtOpenChatDebug('resolve: unique phone hit', want, phoneHits[0].id);
    return phoneHits[0];
  }

  vdtOpenChatDebug('resolve: no safe target', {
    id: id || null,
    want,
    afterSearch,
    visible: items.length,
    ids: items.slice(0, 8).map((el) => el.id),
    phoneHits: phoneHits.map((el) => el.id),
  });
  return null;
}

/** Cuộn virtual list chỉ để tìm đúng chatId (không mở theo SĐT). */
async function scanListForConversationId(channel, chatId) {
  const id = String(chatId || '').trim();
  if (!id) return null;
  const list = conversationListScroller(channel);
  if (!(list instanceof HTMLElement)) return asPancakeListItem(document.getElementById(id));

  const hitNow = asPancakeListItem(document.getElementById(id));
  if (hitNow) return hitNow;

  const maxSteps = 25;
  const step = Math.max(120, Math.floor((list.clientHeight || 400) * 0.6));
  const startTop = list.scrollTop;
  list.scrollTop = 0;
  list.dispatchEvent(new Event('scroll', { bubbles: true }));
  await waitMs(80);
  for (let i = 0; i < maxSteps; i += 1) {
    const found = asPancakeListItem(document.getElementById(id));
    if (found) {
      vdtOpenChatDebug('scan-id: found at step', i, id);
      return found;
    }
    if (list.scrollTop + list.clientHeight >= list.scrollHeight - 8) break;
    list.scrollTop += step;
    list.dispatchEvent(new Event('scroll', { bubbles: true }));
    await waitMs(55);
  }
  const foundEnd = asPancakeListItem(document.getElementById(id));
  if (foundEnd) return foundEnd;
  list.scrollTop = startTop;
  list.dispatchEvent(new Event('scroll', { bubbles: true }));
  vdtOpenChatDebug('scan-id: not found', id);
  return null;
}

/**
 * Chọn dòng kết quả search.
 * Ưu tiên chatId → đúng 1 dòng có SĐT đứng độc lập → đúng 1 dòng list.
 * Không click bừa dòng đầu khi nhiều kết quả (tránh STK chứa chuỗi SĐT).
 */
function pickPancakeSearchResultRow(phone, chatId = '') {
  const want = normalizePhone(phone || '');
  const id = String(chatId || '').trim();
  const items = visiblePancakeListItems();
  if (!items.length) return null;

  if (id) {
    const byId = resolvePancakeTarget(id, want || '', { afterSearch: true });
    if (byId) return byId;
  }

  if (want) {
    const phoneHits = items.filter((item) => extractPhonesFromNode(item).includes(want));
    if (phoneHits.length === 1) return phoneHits[0];
  }

  if (items.length === 1) return items[0];
  return null;
}

/** Pancake: điền SĐT → Enter → click item chat trong kết quả. */
async function pancakeFillSearchAndEnter(phone, chatId = '') {
  const want = normalizePhone(phone || '') || String(phone || '').trim();
  if (!want || !isPancake()) return false;
  const input = pancakeSearchInput();
  if (!input) {
    vdtOpenChatDebug('search: no input');
    return false;
  }

  vdtOpenChatDebug('search: fill+Enter+click', want, 'chatId', chatId || null);
  setPancakeSearchValue(input, want);
  await waitMs(30);

  const enterOpts = {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true,
  };
  input.focus();
  input.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
  input.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
  input.dispatchEvent(new KeyboardEvent('keyup', enterOpts));

  const form = input.closest('form');
  if (form instanceof HTMLFormElement) {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }

  // Đợi Pancake lọc list rồi click đúng item.
  for (let i = 0; i < 12; i += 1) {
    await waitMs(i === 0 ? 350 : 150);
    const row = pickPancakeSearchResultRow(want, chatId);
    if (!row) continue;
    vdtOpenChatDebug('search: click row', row.id || '(no-id)', 'poll', i);
    if (activateConversationEl(row)) return true;
  }

  vdtOpenChatDebug('search: no safe result row', want, 'chatId', chatId || null);
  return false;
}

/**
 * Mở / lọc chat theo kênh hiện tại.
 * Pancake: ưu tiên chatId (DOM + cuộn list), mới fallback search SĐT.
 * Zalo: click list theo id/SĐT.
 */
async function tryFocusPendingChat(channel, chatId, phone = '') {
  if (channel === 'pancake' && !isPancake()) return false;
  if (channel === 'zalo' && !isZalo()) return false;

  vdtOpenChatDebug('open', { channel, chatId, phone });

  if (channel === 'pancake') {
    let el = findPancakeConversationEl(chatId, '');
    if (el && activateConversationEl(el)) {
      vdtOpenChatDebug('open: pancake by visible id', chatId);
      return true;
    }
    el = await scanListForConversationId(channel, chatId);
    if (el && activateConversationEl(el)) {
      vdtOpenChatDebug('open: pancake by scanned id', chatId);
      return true;
    }
    if (!phone) {
      vdtOpenChatDebug('open: pancake id miss and no phone', { chatId });
      return false;
    }
    const ok = await pancakeFillSearchAndEnter(phone, chatId);
    if (!ok) vdtOpenChatDebug('open: pancake search miss', { chatId, phone });
    return ok;
  }

  // Zalo: giữ tìm id / SĐT + cuộn list
  let el = findConversationEl(channel, chatId, phone);
  if (el && activateConversationEl(el)) return true;
  el = await scanListForConversationId(channel, chatId);
  if (el && activateConversationEl(el)) return true;
  el = findConversationEl(channel, '', phone);
  if (el && activateConversationEl(el)) return true;
  return false;
}

function applyPendingListResult(result) {
  if (!result?.ok) return false;
  pendingChatState = {
    count: Number(result.count) || 0,
    items: Array.isArray(result.items) ? result.items : [],
  };
  renderPendingUi(ensureRoot());
  return true;
}

async function copyPendingPhone(phone) {
  const value = String(phone || '').trim();
  if (!value) {
    showToast('Không có SĐT để sao chép.');
    return;
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      const input = document.createElement('textarea');
      input.value = value;
      input.setAttribute('readonly', '');
      input.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    }
    showToast(`Đã chép ${value}`);
  } catch {
    showToast('Không sao chép được SĐT.');
  }
}

function dismissPending(channel, chatId) {
  if (!channel || !chatId) return Promise.resolve();
  return runtimeSend({ type: 'vdt-dismiss-pending-chat', channel, chatId }).then((result) => {
    if (!isExtensionAlive()) return;
    if (!result?.ok) {
      showToast(result?.error || 'Không bỏ qua được.');
      return;
    }
    applyPendingListResult(result);
    showToast('Đã bỏ qua.');
  });
}

function openPendingItem(channel, chatId, phone) {
  pendingPanelOpen = false;
  renderPendingUi(ensureRoot());
  if (phone) {
    postCustomerFill({ phone, channel, chatId });
    lastPhone = '';
    requestLookup(phone, chatId, '');
  }
  const pageChannel = chatChannel();
  if (channel !== pageChannel) {
    showToast(`Mở tab ${channelLabel(channel)} rồi chọn chat ${phone || ''}.`.trim());
    return;
  }
  void tryFocusPendingChat(channel, chatId, phone).then((opened) => {
    if (!isExtensionAlive()) return;
    if (opened) {
      scheduleSync(200);
      return;
    }
    showToast(
      channel === 'pancake'
        ? 'Không thấy ô tìm hội thoại bên trái.'
        : 'Không mở được chat — thử tìm SĐT thủ công.',
    );
  });
}

function shortProvince(label) {
  return String(label || '')
    .replace(/^(thành phố|tinh|tỉnh)\s+/i, '')
    .replace(/^tp\.?\s*/i, '')
    .trim();
}

function customerLinesOf(recent) {
  if (Array.isArray(recent?.lines) && recent.lines.length > 0) return recent.lines;
  const weight = typeof recent?.weightLabel === 'string' ? recent.weightLabel : '';
  const option = typeof recent?.optionLabel === 'string' ? recent.optionLabel : '';
  return [
    {
      productId: null,
      productName: recent?.productName || '',
      weight: weight || option || '',
      quantity: Number(recent?.quantity) > 0 ? Number(recent.quantity) : 1,
      note: '',
      weightScale: 'baby',
      chips: [],
      extras: [],
    },
  ];
}

function clampLineQty(raw) {
  const n = Number(String(raw || '').replace(/\D/g, ''));
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(20, n);
}

/** Extension không hiện chip «Chưa sinh». */
function uiWeightChips(chips) {
  return (Array.isArray(chips) ? chips : []).filter((label) => label !== 'Chưa sinh');
}

function renderLineEditor(line, index, editable) {
  const open = customerEditUi && customerEditUi.lineIndex === index ? customerEditUi : null;
  const weight = String(line.weight || '').trim();
  const qty = clampLineQty(line.quantity);
  const allChips = Array.isArray(line.chips) ? line.chips : [];
  const chips = uiWeightChips(allChips);
  const extras = Array.isArray(line.extras) ? line.extras : [];
  const needsWeight = chips.length + extras.length > 0;
  const weightPill = needsWeight
    ? editable
      ? `<button type="button" class="vdt-pill vdt-pill-weight vdt-pill-edit" data-vdt-edit-weight="${index}" ${customerSaving ? 'disabled' : ''} aria-expanded="${open?.mode === 'weight' ? 'true' : 'false'}">${escapeHtml(weight || 'Cân nặng')}</button>`
      : weight
        ? `<span class="vdt-pill vdt-pill-weight">${escapeHtml(weight)}</span>`
        : ''
    : '';
  const qtyPill = editable
    ? `<button type="button" class="vdt-pill vdt-pill-qty vdt-pill-edit" data-vdt-edit-qty="${index}" ${customerSaving ? 'disabled' : ''} aria-expanded="${open?.mode === 'qty' ? 'true' : 'false'}">×${escapeHtml(String(qty))}</button>`
    : `<span class="vdt-pill vdt-pill-qty">×${escapeHtml(String(qty))}</span>`;

  let editor = '';
  if (editable && open?.mode === 'weight' && needsWeight) {
    const extraOpen = Boolean(open.extraOpen) || (weight && extras.includes(weight) && !allChips.includes(weight));
    editor = `<div class="vdt-line-editor" data-vdt-line-editor="${index}">
      <div class="vdt-weight-chips">
        ${chips
          .map(
            (label) =>
              `<button type="button" class="vdt-chip" data-vdt-weight-chip="${escapeAttr(label)}" data-vdt-line="${index}" aria-pressed="${label === weight}" ${customerSaving ? 'disabled' : ''}>${escapeHtml(label)}</button>`,
          )
          .join('')}
        ${
          extras.length
            ? `<button type="button" class="vdt-chip vdt-chip-more" data-vdt-weight-extra-toggle="${index}" aria-expanded="${extraOpen}" ${customerSaving ? 'disabled' : ''}>+</button>`
            : ''
        }
      </div>
      ${
        extras.length
          ? `<label class="vdt-weight-extra" ${extraOpen ? '' : 'hidden'}>
              <span class="vdt-sr">Cân nặng khác</span>
              <select data-vdt-weight-extra="${index}" ${customerSaving ? 'disabled' : ''}>
                <option value="">Chọn…</option>
                ${extras
                  .map(
                    (label) =>
                      `<option value="${escapeAttr(label)}" ${label === weight ? 'selected' : ''}>${escapeHtml(label)}</option>`,
                  )
                  .join('')}
              </select>
            </label>`
          : ''
      }
    </div>`;
  } else if (editable && open?.mode === 'qty') {
    editor = `<div class="vdt-line-editor vdt-line-editor-qty" data-vdt-line-editor="${index}">
      <div class="vdt-qty-stepper">
        <button type="button" class="vdt-qty-btn" data-vdt-qty-dec="${index}" aria-label="Giảm số lượng" ${customerSaving ? 'disabled' : ''}>−</button>
        <span class="vdt-qty-value">${escapeHtml(String(qty))}</span>
        <button type="button" class="vdt-qty-btn" data-vdt-qty-inc="${index}" aria-label="Tăng số lượng" ${customerSaving ? 'disabled' : ''}>+</button>
      </div>
    </div>`;
  }

  const productName = String(line.productName || '');
  const productLabel = productName || 'Tên sản phẩm';
  const productEl =
    editable && open?.mode === 'name'
      ? `<input class="vdt-product-input" type="text" maxlength="120" value="${escapeAttr(productName)}" data-vdt-product-input="${index}" aria-label="Tên sản phẩm" ${customerSaving ? 'disabled' : ''} />`
      : editable
        ? `<button type="button" class="vdt-product vdt-product-edit" data-vdt-edit-name="${index}" title="Sửa tên sản phẩm" ${customerSaving ? 'disabled' : ''}>${escapeHtml(productLabel)}</button>`
        : `<span class="vdt-product">${escapeHtml(productName)}</span>`;

  return `<div class="vdt-line" data-vdt-line-row="${index}">
    <div class="vdt-line-main">
      ${productEl}
      ${weightPill}
      ${qtyPill}
    </div>
    ${editor}
  </div>`;
}

function pushActiveOrderToPos() {
  const recent = activeCustomer?.recent;
  const orderId = Number(recent?.id);
  postToPos({
    type: 'vdt-active-order',
    orderId: Number.isInteger(orderId) && orderId > 0 ? orderId : null,
    phone: String(activeCustomer?.phone || ''),
  });
}

function renderCustomer(root, customer) {
  const box = customerBox(root);
  if (!(box instanceof HTMLElement)) return;
  const recent = customer.recent;
  if (!recent) {
    activeCustomer = null;
    customerEditUi = null;
    pushActiveOrderToPos();
    setCustomerStatus(root, `Có ${customer.orderCount} đơn · chưa đọc được đơn gần nhất`);
    return;
  }
  activeCustomer = customer;
  const status = recent.fulfillLabel || recent.statusLabel || '';
  const place = shortProvince(customer.provinceLabel);
  const shipped =
    recent.fulfillStatus === 'shipped' ||
    String(recent.fulfillLabel || '').trim().toLowerCase() === 'đã gửi hàng';
  // Đã gửi hàng: chỉ nhân bản + xóa — ẩn ưu tiên và sửa.
  const canMutate = Boolean(recent.editable) && !shipped;
  const priorityOn = Boolean(recent.priority);
  const lines = customerLinesOf(recent);
  const canDelete = Boolean(customerCanDelete);
  const deleteBusy = customerSaving && customerDeleteConfirm;
  box.hidden = false;
  box.dataset.state = 'order';
  const lineSaving = customerSaving && !customerDeleteConfirm;
  box.classList.toggle('is-saving', lineSaving);
  box.innerHTML = `
    <div class="vdt-customer-card${canMutate ? ' is-editable' : ''}${priorityOn && canMutate ? ' is-priority' : ''}${lineSaving ? ' is-saving' : ''}${customerDeleteConfirm ? ' is-confirm-delete' : ''}">
      <div class="vdt-customer-row">
        <span class="vdt-pill vdt-pill-status">${escapeHtml(status)}</span>
        <button type="button" class="vdt-pill vdt-pill-phone" data-vdt-copy-phone="${escapeAttr(customer.phone)}" title="Sao chép SĐT" aria-label="Sao chép ${escapeAttr(customer.phone)}">${escapeHtml(customer.phone)}</button>
        <span class="vdt-date">${escapeHtml(dayLabel(recent.createdAt))}</span>
        <div class="vdt-customer-actions">
          ${
            canMutate
              ? `<button type="button" class="vdt-priority${priorityOn ? ' is-on' : ''}" data-vdt-priority-order title="${priorityOn ? 'Bỏ ưu tiên' : 'Gắn ưu tiên'}" aria-label="${priorityOn ? 'Bỏ ưu tiên' : 'Gắn ưu tiên'}" aria-pressed="${priorityOn ? 'true' : 'false'}" ${customerSaving ? 'disabled' : ''}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8 6.8 19.6l1-5.8L3.5 9.7l5.9-.9L12 3.5z"/></svg>
                </button>`
              : ''
          }
          <button type="button" class="vdt-copy" data-vdt-duplicate-order title="Nhân bản đơn" aria-label="Nhân bản đơn">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/></svg>
          </button>
          ${
            canMutate
              ? `<button type="button" class="vdt-edit" data-vdt-edit-order title="Sửa đơn" aria-label="Sửa đơn" ${customerSaving ? 'disabled' : ''}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                </button>`
              : ''
          }
          ${
            canDelete
              ? `<button type="button" class="vdt-delete" data-vdt-delete-order title="Xóa đơn" aria-label="Xóa đơn" ${customerSaving ? 'disabled' : ''}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"/></svg>
                </button>`
              : ''
          }
        </div>
      </div>
      ${
        customerDeleteConfirm
          ? `<div class="vdt-delete-confirm" role="alertdialog" aria-label="Xác nhận xóa đơn">
              <p class="vdt-delete-confirm-text">Xóa đơn ${escapeHtml(recent.code || '')}? Không hoàn tác được.</p>
              <div class="vdt-delete-confirm-actions">
                <button type="button" class="vdt-delete-cancel" data-vdt-delete-cancel ${deleteBusy ? 'disabled' : ''}>Hủy</button>
                <button type="button" class="vdt-delete-ok" data-vdt-delete-confirm ${deleteBusy ? 'disabled' : ''}>${deleteBusy ? 'Đang xóa…' : 'Xóa đơn'}</button>
              </div>
            </div>`
          : ''
      }
      <div class="vdt-customer-meta">
        ${place ? `<span class="vdt-pill vdt-pill-place">${escapeHtml(place)}</span>` : ''}
        <strong class="vdt-price" data-vdt-order-total>${escapeHtml(money(recent.totalPrice))}</strong>
        ${customerSaving && !customerDeleteConfirm ? '<span class="vdt-saving">Đang lưu…</span>' : ''}
      </div>
      <div class="vdt-lines">${lines.map((line, index) => renderLineEditor(line, index, canMutate)).join('')}</div>
    </div>
  `;
  const nameInput = box.querySelector('[data-vdt-product-input]');
  if (nameInput instanceof HTMLInputElement) {
    nameInput.focus();
    nameInput.select();
  }
  pushActiveOrderToPos();
}

function commitCustomerProductName(lineIndex, raw) {
  if (!customerCanMutate() || customerSaving) return;
  if (!(customerEditUi?.lineIndex === lineIndex && customerEditUi.mode === 'name')) return;
  const name = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  if (!name) {
    showToast('Nhập tên sản phẩm.');
    customerEditUi = { lineIndex, mode: 'name' };
    renderCustomer(ensureRoot(), activeCustomer);
    return;
  }
  const current = String(customerLinesOf(activeCustomer?.recent)[lineIndex]?.productName || '').trim();
  customerEditUi = null;
  if (name === current) {
    renderCustomer(ensureRoot(), activeCustomer);
    return;
  }
  void saveCustomerLines((lines) => {
    if (lines[lineIndex]) lines[lineIndex].productName = name;
  });
}

function customerCanMutate() {
  const recent = activeCustomer?.recent;
  if (!recent?.editable) return false;
  if (recent.fulfillStatus === 'shipped') return false;
  if (String(recent.fulfillLabel || '').trim().toLowerCase() === 'đã gửi hàng') return false;
  return true;
}

function patchCustomerFromOrder(order) {
  if (!activeCustomer?.recent || !order) return;
  const recent = activeCustomer.recent;
  recent.totalPrice = Number(order.totalPrice) || recent.totalPrice;
  recent.quantity = Number(order.quantity) || recent.quantity;
  recent.editable = order.editable !== false;
  if (order.shippingFee != null) recent.shippingFee = Math.max(0, Number(order.shippingFee) || 0);
  if (typeof order.discountCode === 'string') recent.discountCode = order.discountCode;
  if (Array.isArray(order.lines) && order.lines.length) {
    recent.lines = order.lines;
    recent.productName = order.lines[0]?.productName || recent.productName;
    recent.optionLabel = order.lines[0]?.weight || recent.optionLabel;
    recent.weightLabel = order.lines[0]?.weight || recent.weightLabel;
  }
  lookupCache.set(activeCustomer.phone, activeCustomer);
}

function linesPayloadFromCustomer() {
  const lines = customerLinesOf(activeCustomer?.recent);
  return lines.map((line, index) => ({
    slot: String(index),
    productId: line.productId == null ? '' : String(line.productId),
    weight: String(line.weight || ''),
    quantity: String(clampLineQty(line.quantity)),
    name: String(line.productName || ''),
    note: String(line.note || ''),
  }));
}

async function saveCustomerLines(mutate) {
  if (!customerCanMutate() || customerSaving) return;
  const orderId = Number(activeCustomer.recent.id);
  if (!Number.isInteger(orderId) || orderId < 1) return;
  const previousLines = customerLinesOf(activeCustomer.recent).map((line) => ({ ...line }));
  const lines = previousLines.map((line) => ({ ...line }));
  mutate(lines);
  activeCustomer.recent.lines = lines;
  customerSaving = true;
  const root = ensureRoot();
  renderCustomer(root, activeCustomer);
  try {
    const result = await runtimeSend({
      type: 'vdt-update-order-lines',
      orderId,
      lines: linesPayloadFromCustomer(),
    });
    if (!isExtensionAlive()) return;
    if (!result?.ok) {
      activeCustomer.recent.lines = previousLines;
      customerEditUi = null;
      customerSaving = false;
      renderCustomer(ensureRoot(), activeCustomer);
      showToast(result?.error || 'Không cập nhật được đơn.');
      return;
    }
    patchCustomerFromOrder(result.order);
    customerEditUi = null;
    customerSaving = false;
    renderCustomer(root, activeCustomer);
    showToast('Đã cập nhật đơn.');
  } catch {
    activeCustomer.recent.lines = previousLines;
    customerSaving = false;
    customerEditUi = null;
    showToast('Không cập nhật được đơn.');
    renderCustomer(ensureRoot(), activeCustomer);
  }
}

async function confirmDeleteCustomerOrder() {
  if (!activeCustomer?.recent || !customerCanDelete || customerSaving) return;
  const orderId = Number(activeCustomer.recent.id);
  if (!Number.isInteger(orderId) || orderId < 1) return;
  const phone = activeCustomer.phone;
  customerSaving = true;
  renderCustomer(ensureRoot(), activeCustomer);
  try {
    const result = await runtimeSend({ type: 'vdt-delete-order', orderId });
    if (!isExtensionAlive()) return;
    if (!result?.ok) {
      customerSaving = false;
      renderCustomer(ensureRoot(), activeCustomer);
      showToast(result?.error || 'Không xóa được đơn.');
      return;
    }
    lookupCache.delete(phone);
    activeCustomer = null;
    customerEditUi = null;
    customerDeleteConfirm = false;
    customerSaving = false;
    pushActiveOrderToPos();
    setCustomerStatus(ensureRoot(), `Đã xóa đơn · ${phone}`);
    showToast('Đã xóa đơn.');
  } catch {
    customerSaving = false;
    customerDeleteConfirm = false;
    if (activeCustomer) renderCustomer(ensureRoot(), activeCustomer);
    showToast('Không xóa được đơn.');
  }
}

function openOrderInPanel(orderId) {
  const id = Number(orderId);
  if (!Number.isInteger(id) || id < 1) return;
  void setOpen(true);
  postToPos({ type: 'vdt-edit-order', orderId: id });
}

function duplicateActiveOrder() {
  const orderId = Number(activeCustomer?.recent?.id);
  if (!Number.isInteger(orderId) || orderId < 1) {
    showToast('Chưa có đơn để nhân bản.');
    return;
  }
  customerDeleteConfirm = false;
  customerEditUi = null;
  void setOpen(true);
  postToPos({ type: 'vdt-duplicate-order', orderId });
  showToast('Đã nhân bản vào form tạo đơn.');
}

async function toggleActiveOrderPriority() {
  if (!customerCanMutate() || customerSaving) return;
  const orderId = Number(activeCustomer.recent.id);
  if (!Number.isInteger(orderId) || orderId < 1) return;
  const next = !Boolean(activeCustomer.recent.priority);
  customerDeleteConfirm = false;
  customerEditUi = null;
  customerSaving = true;
  renderCustomer(ensureRoot(), activeCustomer);
  try {
    const result = await runtimeSend({ type: 'vdt-order-priority', orderId, priority: next });
    if (!result?.ok) {
      showToast(result?.error || 'Không đổi được ưu tiên.');
      return;
    }
    activeCustomer.recent.priority = next;
    lookupCache.set(activeCustomer.phone, activeCustomer);
    showToast(next ? 'Đã gắn ưu tiên.' : 'Đã bỏ ưu tiên.');
  } catch {
    showToast('Không đổi được ưu tiên.');
  } finally {
    customerSaving = false;
    if (activeCustomer) renderCustomer(ensureRoot(), activeCustomer);
  }
}

function handleCustomerCardClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const copyPhone = target.closest('[data-vdt-copy-phone]');
  if (copyPhone instanceof HTMLElement) {
    void copyPendingPhone(copyPhone.getAttribute('data-vdt-copy-phone') || '');
    return;
  }

  const priorityToggle = target.closest('[data-vdt-priority-order]');
  if (priorityToggle instanceof HTMLElement) {
    void toggleActiveOrderPriority();
    return;
  }

  const editOpen = target.closest('[data-vdt-edit-order]');
  if (editOpen instanceof HTMLElement) {
    if (!customerCanMutate() || customerSaving) return;
    customerDeleteConfirm = false;
    customerEditUi = null;
    openOrderInPanel(activeCustomer.recent.id);
    return;
  }

  const deleteOpen = target.closest('[data-vdt-delete-order]');
  if (deleteOpen instanceof HTMLElement) {
    if (!customerCanDelete || customerSaving) return;
    customerDeleteConfirm = true;
    customerEditUi = null;
    renderCustomer(ensureRoot(), activeCustomer);
    return;
  }

  const deleteCancel = target.closest('[data-vdt-delete-cancel]');
  if (deleteCancel instanceof HTMLElement) {
    customerDeleteConfirm = false;
    renderCustomer(ensureRoot(), activeCustomer);
    return;
  }

  const deleteConfirm = target.closest('[data-vdt-delete-confirm]');
  if (deleteConfirm instanceof HTMLElement) {
    void confirmDeleteCustomerOrder();
    return;
  }

  if (!customerCanMutate() || customerSaving || customerDeleteConfirm) return;

  const weightToggle = target.closest('[data-vdt-edit-weight]');
  if (weightToggle instanceof HTMLElement) {
    const lineIndex = Number(weightToggle.getAttribute('data-vdt-edit-weight'));
    if (!Number.isInteger(lineIndex)) return;
    customerEditUi =
      customerEditUi?.lineIndex === lineIndex && customerEditUi.mode === 'weight'
        ? null
        : { lineIndex, mode: 'weight', extraOpen: false };
    renderCustomer(ensureRoot(), activeCustomer);
    return;
  }

  const qtyToggle = target.closest('[data-vdt-edit-qty]');
  if (qtyToggle instanceof HTMLElement) {
    const lineIndex = Number(qtyToggle.getAttribute('data-vdt-edit-qty'));
    if (!Number.isInteger(lineIndex)) return;
    customerEditUi =
      customerEditUi?.lineIndex === lineIndex && customerEditUi.mode === 'qty'
        ? null
        : { lineIndex, mode: 'qty' };
    renderCustomer(ensureRoot(), activeCustomer);
    return;
  }

  const nameToggle = target.closest('[data-vdt-edit-name]');
  if (nameToggle instanceof HTMLElement) {
    const lineIndex = Number(nameToggle.getAttribute('data-vdt-edit-name'));
    if (!Number.isInteger(lineIndex)) return;
    customerEditUi =
      customerEditUi?.lineIndex === lineIndex && customerEditUi.mode === 'name'
        ? null
        : { lineIndex, mode: 'name' };
    renderCustomer(ensureRoot(), activeCustomer);
    return;
  }

  const chip = target.closest('[data-vdt-weight-chip]');
  if (chip instanceof HTMLElement) {
    const lineIndex = Number(chip.getAttribute('data-vdt-line'));
    const weight = chip.getAttribute('data-vdt-weight-chip') || '';
    if (!Number.isInteger(lineIndex) || !weight) return;
    void saveCustomerLines((lines) => {
      if (lines[lineIndex]) lines[lineIndex].weight = weight;
    });
    return;
  }

  const extraToggle = target.closest('[data-vdt-weight-extra-toggle]');
  if (extraToggle instanceof HTMLElement) {
    const lineIndex = Number(extraToggle.getAttribute('data-vdt-weight-extra-toggle'));
    if (!Number.isInteger(lineIndex)) return;
    customerEditUi = {
      lineIndex,
      mode: 'weight',
      extraOpen: !(customerEditUi?.lineIndex === lineIndex && customerEditUi.extraOpen),
    };
    renderCustomer(ensureRoot(), activeCustomer);
    return;
  }

  const qtyDec = target.closest('[data-vdt-qty-dec]');
  if (qtyDec instanceof HTMLElement) {
    const lineIndex = Number(qtyDec.getAttribute('data-vdt-qty-dec'));
    if (!Number.isInteger(lineIndex)) return;
    void saveCustomerLines((lines) => {
      if (lines[lineIndex]) lines[lineIndex].quantity = clampLineQty(lines[lineIndex].quantity - 1);
    });
    return;
  }

  const qtyInc = target.closest('[data-vdt-qty-inc]');
  if (qtyInc instanceof HTMLElement) {
    const lineIndex = Number(qtyInc.getAttribute('data-vdt-qty-inc'));
    if (!Number.isInteger(lineIndex)) return;
    void saveCustomerLines((lines) => {
      if (lines[lineIndex]) lines[lineIndex].quantity = clampLineQty(lines[lineIndex].quantity + 1);
    });
  }
}

function handleCustomerCardChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) return;
  if (!target.hasAttribute('data-vdt-weight-extra')) return;
  if (!customerCanMutate() || customerSaving) return;
  const lineIndex = Number(target.getAttribute('data-vdt-weight-extra'));
  const weight = target.value;
  if (!Number.isInteger(lineIndex) || !weight) return;
  void saveCustomerLines((lines) => {
    if (lines[lineIndex]) lines[lineIndex].weight = weight;
  });
}

function handleCustomerCardKeydown(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !target.hasAttribute('data-vdt-product-input')) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    customerEditUi = null;
    if (activeCustomer) renderCustomer(ensureRoot(), activeCustomer);
    return;
  }
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const lineIndex = Number(target.getAttribute('data-vdt-product-input'));
  if (!Number.isInteger(lineIndex)) return;
  commitCustomerProductName(lineIndex, target.value);
}

function handleCustomerCardFocusOut(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !target.hasAttribute('data-vdt-product-input')) return;
  // Đổi sang chip khác trong cùng card — không commit sớm.
  const next = event.relatedTarget;
  if (next instanceof Node && target.closest('[data-vdt-customer]')?.contains(next)) return;
  const lineIndex = Number(target.getAttribute('data-vdt-product-input'));
  if (!Number.isInteger(lineIndex)) return;
  // Chỉ commit khi vẫn đang mở editor tên dòng này.
  if (!(customerEditUi?.lineIndex === lineIndex && customerEditUi.mode === 'name')) return;
  commitCustomerProductName(lineIndex, target.value);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

function enqueuePosMessage(payload) {
  if (
    payload.type === 'vdt-fill-customer' ||
    payload.type === 'vdt-fill-address' ||
    payload.type === 'vdt-fill-phone'
  ) {
    pendingPosMessages = pendingPosMessages.filter((item) => item.type !== payload.type);
  }
  pendingPosMessages.push(payload);
}

function flushPendingPosMessages() {
  if (!posReady || !pendingPosMessages.length) return;
  const queue = pendingPosMessages;
  pendingPosMessages = [];
  for (const payload of queue) postToPos(payload, true);
}

function postToPos(payload, force = false) {
  const root = document.getElementById(ROOT_ID);
  const frame = root?.querySelector('.vdt-frame');
  if (!(frame instanceof HTMLIFrameElement) || !frame.contentWindow) {
    enqueuePosMessage(payload);
    return;
  }
  // Iframe mới tạo là about:blank (origin = pancake). postMessage với target
  // workers.dev sẽ ném lỗi — luôn dùng '*' ; POS chỉ nhận source=vdt-ext.
  if (!force && !posReady) {
    enqueuePosMessage(payload);
    return;
  }
  try {
    frame.contentWindow.postMessage({ source: 'vdt-ext', ...payload }, '*');
  } catch {
    enqueuePosMessage(payload);
  }
}

function requestLookup(phone, convId, name) {
  const root = ensureRoot();
  const channel = chatChannel();
  const cached = lookupCache.get(phone);
  if (cached) {
    customerEditUi = null;
    customerSaving = false;
    customerDeleteConfirm = false;
    customerCanDelete = Boolean(cached.canDelete);
    renderCustomer(root, cached);
    postCustomerFill({ phone, name: name || '', channel, chatId: convId });
    return;
  }
  customerEditUi = null;
  customerSaving = false;
  customerDeleteConfirm = false;
  activeCustomer = null;
  pushActiveOrderToPos();
  setCustomerStatus(root, `Đang tra ${phone}…`);
  void runtimeSend({ type: 'vdt-lookup-phone', phone }).then((result) => {
    if (!isExtensionAlive()) return;
    if (!result) {
      setCustomerStatus(root, 'Không tra được khách.');
      return;
    }
    if (selectedConversationId() !== convId && convId) return;
    if (result.error === 'auth') {
      loginUrl = result.loginUrl || loginUrl;
      setAuthBanner(root, true);
      setCustomerStatus(root, 'Cần đăng nhập admin để tra đơn.');
      return;
    }
    if (!result.ok) {
      setCustomerStatus(root, result.error || 'Không tra được khách.');
      return;
    }
    setAuthBanner(root, false);
    customerCanDelete = Boolean(result.canDelete);
    if (!result.found || !result.customer) {
      activeCustomer = null;
      pushActiveOrderToPos();
      setNoOrderStatus(root, phone);
      schedulePendingRefresh(300);
      postCustomerFill({ phone, name: name || '', channel, chatId: convId });
      return;
    }
    result.customer.canDelete = customerCanDelete;
    lookupCache.set(phone, result.customer);
    customerEditUi = null;
    customerSaving = false;
    customerDeleteConfirm = false;
    renderCustomer(root, result.customer);
    schedulePendingRefresh(400);
    postCustomerFill({ phone, name: name || '', channel, chatId: convId });
  });
}

function syncFromPage() {
  const root = ensureRoot();
  const channel = chatChannel();
  const convId = selectedConversationId();
  const name = readChatName();
  const trustedPhone = readTrustedPhone();
  let cachedPhone = null;
  if (channel && convId) {
    cachedPhone = chatPhoneCache.get(chatCacheKey(channel, convId)) || null;
    if (!cachedPhone && channel === 'zalo') {
      for (const id of zaloChatIdCandidates()) {
        cachedPhone = chatPhoneCache.get(chatCacheKey(channel, id)) || null;
        if (cachedPhone) break;
      }
    }
  }
  // Pancake: tag SĐT. Zalo: bubble/thread hoặc SĐT đã map — đều đủ để tra đơn.
  const phoneForHeader = trustedPhone || cachedPhone;
  const phoneForFill = phoneForHeader;
  const openedNewChat = Boolean(convId && convId !== lastConvId);

  if (openedNewChat) {
    lastConvId = convId;
    lastPhone = '';
    lastName = '';
    if (channel) chatPhoneSaveAttempted.delete(chatCacheKey(channel, convId));
    if (channel === 'zalo') {
      // Đổi hội thoại: cho phép tra map/lưu đúng một lần cho chat mới.
      stickyZaloChatId = convId;
      stickyZaloNameKey = readZaloNameChatId();
      for (const id of zaloChatIdCandidates()) chatPhoneSaveAttempted.delete(chatCacheKey(channel, id));
    }
    const box = customerBox(root);
    if (box instanceof HTMLElement) {
      box.hidden = true;
      box.innerHTML = '';
      delete box.dataset.state;
      delete box.dataset.statusText;
    }
  }

  if (!convId) {
    lastConvId = '';
    lastPhone = '';
    lastName = '';
    stickyZaloChatId = '';
    stickyZaloNameKey = '';
    const box = customerBox(root);
    if (box instanceof HTMLElement) {
      box.hidden = true;
      box.innerHTML = '';
      delete box.dataset.state;
      delete box.dataset.statusText;
    }
    return;
  }

  if (name && (name !== lastName || openedNewChat)) {
    postCustomerFill({ name, phone: phoneForFill || undefined, channel, chatId: convId });
    lastName = name;
  }

  // Lưu khi mới mở chat, lần đầu thấy SĐT, hoặc SĐT khách khác số đã cache (cuộn tới số thật).
  if (trustedPhone && channel && convId) {
    const key = chatCacheKey(channel, convId);
    const cached = chatPhoneCache.get(key);
    if (openedNewChat || !chatPhonePersisted.has(key) || cached !== trustedPhone) {
      persistChatPhone(channel, convId, trustedPhone, name || '');
    }
  }

  if (!phoneForHeader) {
    if (channel) requestChatPhoneMap(channel, convId, name || '');
    return;
  }

  if (phoneForHeader === lastPhone && !openedNewChat) return;
  lastPhone = phoneForHeader;
  postCustomerFill({ phone: phoneForHeader, name: name || '', channel, chatId: convId });
  requestLookup(phoneForHeader, convId, name || '');
}

function scheduleSync(delayMs = 280) {
  if (!isExtensionAlive()) return;
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    if (!isExtensionAlive()) return;
    try {
      applyHostChromeOffset();
      syncFromPage();
    } catch {
      /* DOM/extension race */
    }
  }, delayMs);
}

let toastPendingTimer = 0;

function showToast(text) {
  window.clearTimeout(toastPendingTimer);
  toastPendingTimer = 0;
  const root = ensureRoot();
  let toast = root.querySelector('[data-vdt-toast]');
  if (!(toast instanceof HTMLElement)) {
    toast = document.createElement('div');
    toast.className = 'vdt-toast';
    toast.dataset.vdtToast = '1';
    root.appendChild(toast);
  }
  toast.textContent = text;
  toast.hidden = false;
  window.clearTimeout(Number(toast.dataset.timer || 0));
  toast.dataset.timer = String(
    window.setTimeout(() => {
      toast.hidden = true;
    }, 2200),
  );
}

/** Chỉ hiện “Đang…” nếu thao tác kéo dài — tránh nháy toast khi search đã warm. */
function showToastSoon(text, delayMs = 180) {
  window.clearTimeout(toastPendingTimer);
  toastPendingTimer = window.setTimeout(() => {
    toastPendingTimer = 0;
    showToast(text);
  }, delayMs);
}

function cancelPendingToast() {
  window.clearTimeout(toastPendingTimer);
  toastPendingTimer = 0;
}

/** Nạp sẵn ward_mapping trên SW — lần bấm pin không phải chờ cold start ~1MB. */
function scheduleLegacyWarmup(delayMs = 0) {
  if (!isExtensionAlive()) return;
  const run = () => {
    if (!isExtensionAlive()) return;
    void runtimeSend({ type: 'vdt-legacy-warmup' });
  };
  if (delayMs <= 0) {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => run(), { timeout: 2500 });
    } else {
      window.setTimeout(run, 400);
    }
    return;
  }
  window.setTimeout(run, delayMs);
}

function normalizeMessageText(node) {
  return String(node?.innerText || node?.textContent || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function looksLikeAddressText(raw) {
  const text = String(raw || '').trim();
  const flat = text.replace(/\s+/g, ' ');
  if (flat.length < 8 || flat.length > 600) return false;
  const hasPlace =
    /(xã|xa\b|phường|phuong|p\.|p\/|tỉnh|tinh|thành phố|tp\.|tphcm|\bhcm\b|quận|quan|huyện|đường|ngõ|hẻm|ấp|thon|thôn)/i.test(
      flat,
    );
  const hasShortWardDistrict = /(?:^|[^0-9\p{L}])(?:p|ph|q)\.?\s*\d{1,2}\b/iu.test(flat);
  const hasDashedPlace = /\p{L}{2,}(?:\s+\p{L}+){0,3}\s*[-–—]\s*\p{L}{2,}(?:\s+\p{L}+){0,3}\s*[-–—]\s*\p{L}{2,}/u.test(flat);
  const hasPhone = /(?:\+?84|0)[\d.\s-]{8,16}/.test(flat);
  const hasNumber = /\d/.test(flat);
  return Boolean(
    hasPlace ||
      hasShortWardDistrict ||
      hasDashedPlace ||
      (hasNumber && /[,\n]/.test(text)) ||
      (hasPhone && hasNumber && flat.split(/\s+/).length >= 4),
  );
}

function readPhoneFromText(text) {
  return extractPhonesFromText(text)[0] || null;
}

function legacySearchOnce(query) {
  return runtimeSend({ type: 'vdt-legacy-search', query }).then((data) =>
    data && typeof data === 'object' ? data : { ok: false },
  );
}

/** Service worker MV3 có thể ngủ — thử lại 1 lần sau warmup ngắn. */
async function legacySearchReliable(query) {
  let data = await legacySearchOnce(query);
  if (data?.ok) return data;
  await runtimeSend({ type: 'vdt-legacy-warmup' });
  await new Promise((resolve) => window.setTimeout(resolve, 60));
  data = await legacySearchOnce(query);
  return data;
}

/** Log pipeline nhận diện địa chỉ — mở DevTools trang chat, filter `[VDT-ADDR]`. */
function logAddrDebug(step, payload) {
  try {
    console.groupCollapsed(`[VDT-ADDR] ${step}`);
    console.log(payload);
    console.groupEnd();
  } catch {
    /* ignore */
  }
}

const ADDR_HOST_ATTR = 'data-vdt-addr-host';
const ADDR_BTN_ATTR = 'data-vdt-addr-btn';
async function applyAddressFromChat(address) {
  const channel = chatChannel();
  const chatId = selectedConversationId();
  const phone = readPhoneFromText(address);
  logAddrDebug('pin-click', { address, phone, channel, chatId });
  if (phone && channel && chatId) {
    persistChatPhone(channel, chatId, phone, readChatName() || '');
  }
  if (phone) {
    postCustomerFill({ phone, channel, chatId });
  }

  void setOpen(true);
  const root = ensureRoot();
  const frame = root.querySelector('.vdt-frame');
  if (frame instanceof HTMLIFrameElement) void preparePosFrame(frame);

  // Warm song song; toast chờ chỉ hiện nếu SW còn cold / search > ~180ms.
  scheduleLegacyWarmup(0);
  showToastSoon('Đang nhận diện địa chỉ…', 180);
  const data = await legacySearchReliable(address);
  cancelPendingToast();
  logAddrDebug('search-result', {
    ok: data?.ok,
    ready: data?.ready,
    more: data?.more,
    debug: data?.debug,
    items: Array.isArray(data?.items)
      ? data.items.slice(0, 5).map((item) => ({
          oldText: item.oldText,
          newText: item.newText,
          provinceCode: item.provinceCode,
          wardCode: item.wardCode,
          line: item.line,
        }))
      : data?.items,
  });
  if (data?.ok && Array.isArray(data.items) && data.items.length > 0) {
    const hit = data.items[0];
    const samePlace = data.items.every(
      (item) => item.provinceCode === hit.provinceCode && item.wardCode === hit.wardCode,
    );
    if (data.items.length === 1 || samePlace) {
      const line = typeof hit.line === 'string' ? hit.line : '';
      const composed = [line, hit.wardName, hit.provinceName].filter(Boolean).join(', ');
      logAddrDebug('auto-fill', {
        composed,
        provinceCode: hit.provinceCode,
        wardCode: hit.wardCode,
        newText: hit.newText,
        line,
      });
      const oldText = typeof hit.oldText === 'string' ? hit.oldText : '';
      const newText = typeof hit.newText === 'string' ? hit.newText : '';
      postToPos({
        type: 'vdt-fill-address',
        address: composed || address,
        provinceCode: hit.provinceCode,
        wardCode: hit.wardCode,
        line,
        oldText: oldText || undefined,
        newText: newText || undefined,
        phone: phone || undefined,
        matched: true,
        channel: channel || undefined,
        chatId: chatId || undefined,
      });
      showToast(
        posReady
          ? oldText
            ? `Đã map: ${newText}`
            : `Đã điền: ${newText}`
          : 'Đã gửi địa chỉ — đợi form tải xong',
      );
      return;
    }
    // Nhiều kết quả khác nhau → điền tạm kết quả đứng đầu + list để đổi (tránh giữ địa chỉ cũ).
    const line = typeof hit.line === 'string' ? hit.line : '';
    logAddrDebug('need-pick', {
      count: data.items.length,
      reason: 'ambiguous',
      provisional: { provinceCode: hit.provinceCode, wardCode: hit.wardCode, newText: hit.newText, line },
    });
    postToPos({
      type: 'vdt-fill-address',
      address,
      provinceCode: hit.provinceCode,
      wardCode: hit.wardCode,
      line,
      oldText: typeof hit.oldText === 'string' && hit.oldText ? hit.oldText : undefined,
      newText: typeof hit.newText === 'string' && hit.newText ? hit.newText : undefined,
      phone: phone || undefined,
      matched: false,
      needPick: true,
      legacyQuery: address,
      legacyItems: data.items.slice(0, 8),
      channel: channel || undefined,
      chatId: chatId || undefined,
    });
    showToast(`Đã chọn tạm ${hit.newText} — đổi nếu sai`);
    return;
  }
  logAddrDebug('need-pick', {
    count: 0,
    reason: data?.debug?.reason || (data?.ok === false ? 'search-failed' : 'no-match'),
  });
  postToPos({
    type: 'vdt-fill-address',
    address,
    phone: phone || undefined,
    matched: false,
    needPick: true,
    legacyQuery: address,
    channel: channel || undefined,
    chatId: chatId || undefined,
  });
  showToast('Chưa khớp xã/tỉnh — đã dán nội dung, chọn tay hoặc tìm địa chỉ cũ');
}

/** Giữ bubble nhỏ nhất chứa địa chỉ (tránh gắn nút chồng lên cha/con). */
function collectAddressHosts() {
  const candidates = [];
  const nodes = isZalo()
    ? document.querySelectorAll(
        '[data-id="div_ReceivedMsg_Text"], [data-id*="ReceivedMsg_Text"], [data-id*="ReceivedMsg"], ' + MESSAGE_BUBBLE_SELECTOR,
      )
    : document.querySelectorAll(MESSAGE_BUBBLE_SELECTOR);
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.closest(`#${ROOT_ID}`)) continue;
    if (node.closest(CHAT_LIST_SEL)) continue;
    if (node.closest(`[${ADDR_BTN_ATTR}]`)) continue;
    // Không gắn pin trên tin mình gửi (Zalo SentMsg / Pancake page·staff).
    if (!isCustomerAddressMessage(node)) continue;
    const text = normalizeMessageText(node);
    if (!looksLikeAddressText(text)) continue;
    candidates.push(node);
  }
  return candidates.filter((node) => !candidates.some((other) => other !== node && node.contains(other)));
}

/** Cùng luồng với nút pin: đọc text bubble → map địa chỉ vào form. */
function tryApplyAddressFromHost(host) {
  if (!(host instanceof HTMLElement)) return false;
  const address = normalizeMessageText(host);
  if (!looksLikeAddressText(address)) {
    showToast('Không thấy địa chỉ trong tin này');
    return false;
  }
  void applyAddressFromChat(address);
  return true;
}

function ensureAddressButton(host) {
  if (!(host instanceof HTMLElement)) return;
  let btn = host.querySelector(`[${ADDR_BTN_ATTR}]`);
  if (btn instanceof HTMLButtonElement) return;
  host.setAttribute(ADDR_HOST_ATTR, '1');
  btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'vdt-addr-btn';
  btn.setAttribute(ADDR_BTN_ATTR, '1');
  btn.title = 'Nhận địa chỉ vào form đơn (hoặc double-click tin)';
  btn.setAttribute('aria-label', 'Nhận địa chỉ vào form đơn');
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-5.3 7-11a7 7 0 1 0-14 0c0 5.7 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>';
  btn.addEventListener(
    'click',
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      tryApplyAddressFromHost(host);
    },
    true,
  );
  host.appendChild(btn);
}

function sweepAddressButtons(activeHosts) {
  const active = new Set(activeHosts);
  for (const host of document.querySelectorAll(`[${ADDR_HOST_ATTR}]`)) {
    if (!(host instanceof HTMLElement)) continue;
    if (active.has(host)) continue;
    host.querySelector(`[${ADDR_BTN_ATTR}]`)?.remove();
    host.removeAttribute(ADDR_HOST_ATTR);
  }
}

function scanAddressButtons() {
  const hosts = collectAddressHosts();
  sweepAddressButtons(hosts);
  for (const host of hosts) ensureAddressButton(host);
}

function scheduleAddressScan() {
  if (!isExtensionAlive()) return;
  window.clearTimeout(addrScanTimer);
  addrScanTimer = window.setTimeout(() => {
    if (!isExtensionAlive()) return;
    try {
      scanAddressButtons();
    } catch {
      /* ignore DOM race */
    }
  }, 180);
}

function watchChatPages() {
  if (!isPancake() && !isZalo()) return;
  if (chatObserver) return;
  chatObserver = new MutationObserver(() => {
    if (!isExtensionAlive()) {
      markExtensionDead();
      return;
    }
    scheduleSync();
    scheduleAddressScan();
    scheduleListPhoneScan();
  });
  chatObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  document.addEventListener(
    'dblclick',
    (event) => {
      if (!isExtensionAlive()) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(`#${ROOT_ID}`)) return;
      if (target.closest(`[${ADDR_BTN_ATTR}]`)) return;
      const host = target.closest(`[${ADDR_HOST_ATTR}]`);
      if (!(host instanceof HTMLElement)) return;
      event.preventDefault();
      event.stopPropagation();
      tryApplyAddressFromHost(host);
    },
    true,
  );
  document.addEventListener(
    'click',
    (event) => {
      if (!isExtensionAlive()) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(`[${ADDR_BTN_ATTR}]`)) return;
      if (
        target.closest(
          '.conversation-list-item, .body-conver-item, .name-module, .threadChat, .msg-item, .conv-item, [class*="conversation"]',
        )
      ) {
        scheduleSync();
        scheduleAddressScan();
        scheduleListPhoneScan(350);
      }
    },
    true,
  );
  // Cuộn list ảo hóa — quét lại để bắt SĐT ở dòng mới hiện.
  document.addEventListener(
    'scroll',
    (event) => {
      if (!isExtensionAlive()) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        target.closest(
          '#conversationList, #conversationlist, .conversation-list, [class*="conversation-list"], .left-nav',
        )
      ) {
        scheduleListPhoneScan(500);
      }
    },
    true,
  );
  scheduleSync();
  scheduleAddressScan();
  scheduleListPhoneScan(400);
  schedulePendingRefresh(300);
}

function panelFrameUrl(bust = false) {
  const url = extensionUrl('panel.html');
  if (!url) return '';
  return bust ? `${url}?t=${Date.now()}` : url;
}

async function preparePosFrame(frame, { forceReload = false } = {}) {
  const root = ensureRoot();
  if (!(frame instanceof HTMLIFrameElement)) return;
  if (!isExtensionAlive()) return;

  // UI là panel extension — không nhúng trang Astro. Session admin dùng qua background fetch.
  const sync = await syncSession(forceReload);
  if (!isExtensionAlive()) return;
  if (sync?.posUrl) rememberPosUrl(sync.posUrl);
  loginUrl = sync?.loginUrl || loginUrl;
  // Auth chi tiết hiện trong panel; banner shell chỉ khi mất session rõ ràng.
  setAuthBanner(root, false);

  const base = extensionUrl('panel.html');
  const url = panelFrameUrl(forceReload);
  if (!base || !url) return;
  posOrigin = new URL(base).origin;
  if (!forceReload && sameFrameUrl(frame, base)) {
    postToPos({ type: 'vdt-ping' }, true);
    return;
  }
  posReady = false;
  pendingPosMessages = [];
  frame.loading = 'eager';
  frame.src = url;
}

function ensureRoot() {
  let root = document.getElementById(ROOT_ID);
  if (root) return root;

  root = document.createElement('div');
  root.id = ROOT_ID;
  applyHostChromeOffset(root);
  root.innerHTML = `
    <div class="vdt-shell" role="complementary" aria-label="Tạo đơn nhanh">
      <div class="vdt-resizer" role="separator" aria-orientation="vertical" aria-label="Kéo chỉnh độ rộng" title="Kéo để chỉnh độ rộng"></div>
      <div class="vdt-bar">
        <strong>Tạo đơn nhanh</strong>
        <div class="vdt-today-stats" data-vdt-today-stats hidden aria-live="polite"></div>
        <div class="vdt-bar-actions">
          <button type="button" class="vdt-pending-badge" data-vdt-pending-badge hidden title="SĐT chưa có đơn" aria-expanded="false">
            <span data-vdt-pending-count>0</span> <span data-vdt-pending-label>đơn chưa lưu</span>
          </button>
          <button type="button" class="vdt-collapse" data-vdt-collapse title="Thu gọn" aria-label="Thu gọn">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </button>
        </div>
      </div>
      <div class="vdt-pending-panel" data-vdt-pending-panel hidden>
        <div class="vdt-pending-head">
          <span>SĐT chưa có đơn</span>
          <button type="button" data-vdt-pending-close title="Đóng">Đóng</button>
        </div>
        <ul class="vdt-pending-list" data-vdt-pending-list></ul>
      </div>
      <div class="vdt-auth" data-vdt-auth hidden>
        <p data-vdt-auth-text>Chưa đăng nhập admin. Đăng nhập trên trang quản trị một lần — sidebar dùng chung phiên.</p>
        <div class="vdt-auth-actions">
          <button type="button" data-vdt-login>Mở đăng nhập</button>
          <button type="button" data-vdt-resync>Đã đăng nhập — tải lại</button>
        </div>
      </div>
      <div class="vdt-customer" data-vdt-customer hidden></div>
      <iframe class="vdt-frame" title="Tạo đơn POS" loading="eager" allow="clipboard-read; clipboard-write"></iframe>
    </div>
    <button type="button" class="vdt-tab" data-vdt-expand title="Mở tạo đơn">Tạo đơn</button>
  `;
  document.documentElement.appendChild(root);

  const frame = root.querySelector('.vdt-frame');
  root.querySelector('[data-vdt-collapse]')?.addEventListener('click', () => setOpen(false));
  root.querySelector('[data-vdt-expand]')?.addEventListener('click', () => setOpen(true));
  root.querySelector('[data-vdt-login]')?.addEventListener('click', () => {
    void runtimeSend({ type: 'vdt-open-login' });
  });
  root.querySelector('[data-vdt-resync]')?.addEventListener('click', () => {
    void preparePosFrame(frame, { forceReload: true }).then(() => {
      scheduleSync();
      schedulePendingRefresh(200);
    });
  });
  root.querySelector('[data-vdt-pending-badge]')?.addEventListener('click', () => {
    pendingPanelOpen = !pendingPanelOpen;
    renderPendingUi(root);
  });
  root.querySelector('[data-vdt-pending-close]')?.addEventListener('click', () => {
    pendingPanelOpen = false;
    renderPendingUi(root);
  });
  root.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const dismissCurrent = target.closest('[data-vdt-pending-dismiss-current]');
    if (dismissCurrent instanceof HTMLElement) {
      const channel = chatChannel();
      const chatId = selectedConversationId();
      if (channel && chatId) void dismissPending(channel, chatId);
      return;
    }

    const copyBtn = target.closest('[data-vdt-pending-copy]');
    if (copyBtn instanceof HTMLElement) {
      const row = copyBtn.closest('[data-vdt-pending-item]');
      if (row instanceof HTMLElement) {
        void copyPendingPhone(row.dataset.phone || '');
      }
      return;
    }

    const dismissBtn = target.closest('[data-vdt-pending-dismiss]');
    if (dismissBtn instanceof HTMLElement) {
      const row = dismissBtn.closest('[data-vdt-pending-item]');
      if (row instanceof HTMLElement) {
        void dismissPending(row.dataset.channel || '', row.dataset.chatId || '');
      }
      return;
    }

    const openBtn = target.closest('[data-vdt-pending-open]');
    if (openBtn instanceof HTMLElement) {
      const row = openBtn.closest('[data-vdt-pending-item]');
      if (row instanceof HTMLElement) {
        openPendingItem(row.dataset.channel || '', row.dataset.chatId || '', row.dataset.phone || '');
      }
      return;
    }

    const duplicateOrder = target.closest('[data-vdt-duplicate-order]');
    if (duplicateOrder instanceof HTMLButtonElement) {
      duplicateActiveOrder();
      return;
    }
    handleCustomerCardClick(event);
  });
  root.addEventListener('change', handleCustomerCardChange);
  root.addEventListener('keydown', handleCustomerCardKeydown);
  root.addEventListener('focusout', handleCustomerCardFocusOut);
  bindResize(root);
  window.addEventListener(
    'resize',
    () => {
      applyHostChromeOffset(root);
      applyHostLayoutInset(root);
    },
    { passive: true },
  );

  return root;
}

async function setOpen(open) {
  const root = ensureRoot();
  desiredOpen = Boolean(open);
  if (!panelReady && desiredOpen) {
    // Giữ ẩn đến khi form sẵn sàng — chỉ hiện nút tab nếu đang thu.
    root.classList.add('is-booting');
    root.classList.add('is-collapsed');
  } else {
    root.classList.toggle('is-collapsed', !desiredOpen);
    if (panelReady) root.classList.remove('is-booting');
  }
  applyHostLayoutInset(root);
  await storageSet('sync', { [STORAGE_OPEN]: desiredOpen });
  if (desiredOpen) {
    scheduleTodayStatsRefresh(200);
    syncTodayStatsPolling();
  } else {
    window.clearTimeout(todayStatsPollTimer);
    todayStatsPollTimer = 0;
  }
}

let overlayMountStarted = false;

async function mount() {
  if (!isExtensionAlive() || !isAllowedOverlayPage()) return;
  // Shell dựng sớm nhưng ẩn (is-booting) đến khi panel báo sẵn sàng + có form.
  const root = ensureRoot();
  const frame = root.querySelector('.vdt-frame');
  root.classList.add('is-booting');
  root.classList.add('is-collapsed');

  if (overlayMountStarted) {
    const stored = await storageGet('sync', [STORAGE_OPEN, STORAGE_WIDTH]);
    if (!isExtensionAlive() || !isAllowedOverlayPage()) {
      tearDownOverlayShell();
      return;
    }
    applyWidth(root, stored[STORAGE_WIDTH] ?? DEFAULT_WIDTH);
    desiredOpen = stored[STORAGE_OPEN] !== false;
    await preparePosFrame(frame);
    if (panelReady) revealOverlayIfReady();
    scheduleListPhoneScan(500);
    schedulePendingRefresh(400);
    scheduleTodayStatsRefresh(400);
    if (desiredOpen) syncTodayStatsPolling();
    return;
  }
  overlayMountStarted = true;

  window.addEventListener('message', (event) => {
    if (!isExtensionAlive()) return;
    const data = event.data;
    if (!data || data.source !== 'vdt-pos') return;
    if (posOrigin && event.origin !== posOrigin) return;
    if (data.type === 'vdt-pos-ready') {
      posReady = true;
      panelReady = true;
      flushPendingPosMessages();
      postToPos({ type: 'vdt-host-channel', channel: chatChannel() || '' }, true);
      pushActiveOrderToPos();
      revealOverlayIfReady();
      scheduleSync();
      return;
    }
    if (data.type === 'vdt-request-active-order') {
      pushActiveOrderToPos();
      return;
    }
    if (data.type === 'vdt-order-updated') {
      const rawPhone = typeof data.phone === 'string' ? data.phone.trim() : '';
      const phone = normalizePhone(rawPhone) || rawPhone;
      if (!phone) return;
      lookupCache.delete(phone);
      if (rawPhone && rawPhone !== phone) lookupCache.delete(rawPhone);
      const channel = chatChannel();
      const chatId = selectedConversationId();
      const name = readChatName() || lastName || '';
      if (channel && chatId) persistChatPhone(channel, chatId, phone, name);
      schedulePendingRefresh(200);
      scheduleTodayStatsRefresh(150);
      // Luôn tra lại để hiện card đơn vừa tạo/sửa — không phụ thuộc lastPhone.
      lastPhone = '';
      requestLookup(phone, chatId || lastConvId, name);
      return;
    }
    if (data.type === 'vdt-send-confirm') {
      const messages = Array.isArray(data.messages) ? data.messages.map((item) => String(item || '').trim()).filter(Boolean) : [];
      void sendConfirmMessages(messages).then((result) => {
        const frame = document.getElementById(ROOT_ID)?.querySelector('.vdt-frame');
        if (frame instanceof HTMLIFrameElement && frame.contentWindow) {
          try {
            frame.contentWindow.postMessage(
              { source: 'vdt-ext', type: 'vdt-send-confirm-result', ok: Boolean(result?.ok), error: result?.error || '' },
              '*',
            );
          } catch {
            /* ignore */
          }
        }
        // Lỗi/thành công đã báo trong panel — không toast thêm cho khỏi chồng thông báo.
      });
    }
  });

  const storedPromise = storageGet('sync', [STORAGE_OPEN, STORAGE_WIDTH]);
  const preparePromise = preparePosFrame(frame);
  watchChatPages();
  // Warm index địa chỉ sớm (idle) — SW MV3 hay ngủ, lần pin đầu sẽ không đợi nạp 1MB.
  scheduleLegacyWarmup(0);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleLegacyWarmup(0);
  });

  const stored = await storedPromise;
  if (!isExtensionAlive()) return;
  applyWidth(root, stored[STORAGE_WIDTH] ?? DEFAULT_WIDTH);
  desiredOpen = stored[STORAGE_OPEN] !== false;
  // Fallback: nếu panel lỗi, vẫn hiện sau 6s để không kẹt ẩn.
  window.clearTimeout(bootRevealTimer);
  bootRevealTimer = window.setTimeout(() => {
    panelReady = true;
    revealOverlayIfReady();
  }, 6000);

  await preparePromise;
  if (panelReady) revealOverlayIfReady();
  scheduleListPhoneScan(500);
  schedulePendingRefresh(400);
  scheduleTodayStatsRefresh(400);
  if (desiredOpen) syncTodayStatsPolling();
}

installContextGuards();

try {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isExtensionAlive()) return undefined;
    if (message?.type === 'vdt-toggle-overlay') {
      const root = document.getElementById(ROOT_ID);
      const next = !(root && !root.classList.contains('is-collapsed'));
      void setOpen(next).then(() => sendResponse({ ok: true, open: next }));
      return true;
    }
    if (message?.type === 'vdt-set-overlay') {
      void setOpen(Boolean(message.open)).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (message?.type === 'vdt-session-changed') {
      const root = ensureRoot();
      const frame = root.querySelector('.vdt-frame');
      panelReady = false;
      posReady = false;
      root.classList.add('is-booting');
      root.classList.add('is-collapsed');
      void preparePosFrame(frame, { forceReload: true }).then(() => {
        lookupCache.clear();
        chatPhoneCache.clear();
        chatLookupPending.clear();
        chatMapTried.clear();
        chatPhonePersisted.clear();
        chatPhoneSaveAttempted.clear();
        pendingChatState = { count: 0, items: [] };
        pendingPanelOpen = false;
        stickyZaloChatId = '';
        stickyZaloNameKey = '';
        lastPhone = '';
        lastName = '';
        lastConvId = '';
        scheduleSync();
        schedulePendingRefresh(300);
        scheduleTodayStatsRefresh(300);
        sendResponse({ ok: true });
      });
      return true;
    }
    return undefined;
  });
} catch {
  markExtensionDead();
}

function syncOverlayPageGate() {
  if (!isExtensionAlive()) return;
  if (!isAllowedOverlayPage()) {
    tearDownOverlayShell();
    return;
  }
  if (!document.getElementById(ROOT_ID)) void mount();
}

function installOverlayPageGate() {
  let href = location.href;
  const tick = () => {
    if (location.href === href) return;
    href = location.href;
    syncOverlayPageGate();
  };
  window.addEventListener('popstate', tick);
  try {
    const wrap = (fn) =>
      function patchedHistory(...args) {
        const result = fn.apply(this, args);
        queuePromise.resolve().then(tick);
        return result;
      };
    history.pushState = wrap(history.pushState.bind(history));
    history.replaceState = wrap(history.replaceState.bind(history));
  } catch {
    /* ignore */
  }
  window.setInterval(tick, 1200);
}

installOverlayPageGate();
if (isAllowedOverlayPage()) {
  void mount();
}
