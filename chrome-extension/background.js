importScripts('legacy-search.js');

const DEFAULT_POS_URL = 'https://vong-dau-tam.yendev96.workers.dev/admin/orders/pos';
const SESSION_COOKIE = 'admin_session';

function normalizePosUrl(value) {
  const trimmed = String(value || '').trim().replace(/\/$/, '');
  if (!trimmed) return DEFAULT_POS_URL;
  try {
    const url = new URL(trimmed);
    if (!/^https?:$/.test(url.protocol)) throw new Error('protocol');
    if (!url.pathname.includes('/admin/orders/pos')) {
      url.pathname = '/admin/orders/pos';
      url.search = '';
      url.hash = '';
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return DEFAULT_POS_URL;
  }
}

async function getPosUrl() {
  const stored = await chrome.storage.sync.get(['posUrl']);
  return normalizePosUrl(stored.posUrl);
}

/** Cookie đăng nhập tab admin (first-party, không partition). */
async function readAdminSessionCookie(posUrl) {
  try {
    const direct = await chrome.cookies.get({ url: posUrl, name: SESSION_COOKIE });
    if (direct?.value) return direct;
    const origin = new URL(posUrl).origin;
    const listed = await chrome.cookies.getAll({ url: `${origin}/`, name: SESSION_COOKIE });
    return listed.find((item) => item?.value && !item.partitionKey) || listed.find((item) => item?.value) || null;
  } catch {
    return null;
  }
}

/**
 * Kiểm tra cookie admin first-party (tab đăng nhập).
 * Panel extension gọi API qua SW + cookie này — không cần partition vào Pancake/Zalo.
 */
async function syncSessionToPage(_pageUrl) {
  const posUrl = await getPosUrl();
  const origin = new URL(posUrl).origin;
  const cookie = await readAdminSessionCookie(posUrl);
  if (!cookie) {
    return {
      ok: false,
      reason: 'no-session',
      posUrl,
      loginUrl: `${origin}/admin/login?next=${encodeURIComponent('/admin/orders/pos')}`,
    };
  }
  try {
    await chrome.storage.local.set({ posUrlCached: posUrl });
  } catch {
    /* ignore */
  }
  return { ok: true, posUrl };
}

async function adminFetchJson(pathWithQuery, options = {}) {
  let posUrl;
  let origin;
  try {
    posUrl = await getPosUrl();
    origin = new URL(posUrl).origin;
  } catch {
    return { ok: false, error: 'URL POS không hợp lệ.' };
  }
  const cookie = await readAdminSessionCookie(posUrl);
  const loginUrl = `${origin}/admin/login?next=${encodeURIComponent('/admin/orders/pos')}`;
  if (!cookie) {
    return { ok: false, error: 'auth', loginUrl };
  }
  const method = options.method || 'GET';
  // Không gắn tay header Cookie (Chrome cấm/strip). host_permissions + credentials:include gửi session.
  const headers = { accept: 'application/json', ...(options.headers || {}) };
  const init = {
    method,
    credentials: 'include',
    headers,
    redirect: 'manual',
  };
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }
  let response;
  try {
    response = await fetch(`${origin}${pathWithQuery}`, init);
  } catch {
    // Mạng/DNS/SW sleep — không để Uncaught (in promise) Failed to fetch.
    return { ok: false, error: 'Không kết nối được máy chủ. Thử lại.' };
  }
  if (response.type === 'opaqueredirect' || response.status === 301 || response.status === 302 || response.status === 303) {
    return { ok: false, error: 'auth', loginUrl };
  }
  if (response.status === 401) {
    try {
      const data = await response.json();
      return { ...data, ok: false, error: 'auth', loginUrl: data.loginUrl || loginUrl };
    } catch {
      return { ok: false, error: 'auth', loginUrl };
    }
  }
  if (!response.ok) {
    try {
      return await response.json();
    } catch {
      return { ok: false, error: 'Không tra được dữ liệu.' };
    }
  }
  try {
    return await response.json();
  } catch {
    return { ok: false, error: 'Phản hồi không hợp lệ.' };
  }
}

const BOOTSTRAP_CACHE_KEY = 'posBootstrapCache';
/** @type {object | null} */
let bootstrapMemory = null;
/** @type {Promise<object> | null} */
let bootstrapInflight = null;

async function readBootstrapCache() {
  if (bootstrapMemory?.ok) return bootstrapMemory;
  try {
    const stored = await chrome.storage.local.get([BOOTSTRAP_CACHE_KEY]);
    const cached = stored?.[BOOTSTRAP_CACHE_KEY];
    if (cached && typeof cached === 'object' && cached.ok) {
      bootstrapMemory = cached;
      return cached;
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function writeBootstrapCache(data) {
  if (!data?.ok) return;
  bootstrapMemory = data;
  try {
    await chrome.storage.local.set({ [BOOTSTRAP_CACHE_KEY]: data });
  } catch {
    /* ignore */
  }
}

/**
 * Panel chạy origin chrome-extension:// — ảnh /media/... tương đối sẽ hỏng.
 * Luôn gắn absolute URL trước khi trả bootstrap cho UI.
 */
async function absolutizeBootstrapMedia(data) {
  if (!data || typeof data !== 'object') return data;
  let origin = '';
  try {
    origin = new URL(await getPosUrl()).origin;
  } catch {
    origin = '';
  }
  if (!origin) return data;
  data.adminOrigin = origin;
  if (Array.isArray(data.products)) {
    data.products = data.products.map((product) => {
      let cover = typeof product?.coverUrl === 'string' ? product.coverUrl : '';
      if (!cover) return product;
      // Cache/UI cũ có thể đã resolve nhầm sang chrome-extension://…/media/…
      if (cover.startsWith('chrome-extension:')) {
        const idx = cover.indexOf('/media/');
        cover = idx >= 0 ? cover.slice(idx) : '';
        if (!cover) return { ...product, coverUrl: null };
      }
      if (/^https?:\/\//i.test(cover)) return product;
      return {
        ...product,
        coverUrl: `${origin}${cover.startsWith('/') ? '' : '/'}${cover}`,
      };
    });
  }
  return data;
}

async function posBootstrap({ force = false } = {}) {
  if (!force && bootstrapInflight) return bootstrapInflight;
  bootstrapInflight = (async () => {
    const data = await absolutizeBootstrapMedia(await adminFetchJson('/admin/orders/pos-bootstrap'));
    if (data?.ok) await writeBootstrapCache(data);
    return data;
  })().finally(() => {
    bootstrapInflight = null;
  });
  return bootstrapInflight;
}

async function posBootstrapPeek() {
  const cached = await readBootstrapCache();
  if (!cached?.ok) return { ok: false, error: 'empty' };
  return absolutizeBootstrapMedia(cached);
}

async function posCreate(payload) {
  return adminFetchJson('/admin/orders/pos-create', { method: 'POST', body: payload || {} });
}

async function lookupPhone(phone) {
  return adminFetchJson(`/admin/orders/lookup?phone=${encodeURIComponent(phone)}`);
}

async function withCsrfPost(path, body) {
  const post = async (csrf) =>
    adminFetchJson(path, {
      method: 'POST',
      body: { ...(body || {}), csrf: csrf || '' },
    });

  let boot = await readBootstrapCache();
  if (!boot?.csrf) boot = await posBootstrap({ force: true });
  let result = await post(boot?.csrf || '');
  if (result?.error && /phiên|csrf/i.test(String(result.error))) {
    boot = await posBootstrap({ force: true });
    result = await post(boot?.csrf || '');
  }
  return result;
}

async function updateOrderLines(orderId, lines) {
  const id = Number(orderId);
  if (!Number.isInteger(id) || id < 1) return { ok: false, error: 'Đơn không hợp lệ.' };
  if (!Array.isArray(lines) || lines.length < 1) return { ok: false, error: 'Thêm ít nhất một sản phẩm.' };
  return withCsrfPost(`/admin/orders/${id}/lines`, { lines });
}

async function deleteOrderById(orderId) {
  const id = Number(orderId);
  if (!Number.isInteger(id) || id < 1) return { ok: false, error: 'Đơn không hợp lệ.' };
  return withCsrfPost(`/admin/orders/${id}/delete`, {});
}

async function getPosOrder(orderId) {
  const id = Number(orderId);
  if (!Number.isInteger(id) || id < 1) return { ok: false, error: 'Đơn không hợp lệ.' };
  return adminFetchJson(`/admin/orders/${id}/pos`);
}

async function updatePosOrder(orderId, payload) {
  const id = Number(orderId);
  if (!Number.isInteger(id) || id < 1) return { ok: false, error: 'Đơn không hợp lệ.' };
  return withCsrfPost(`/admin/orders/${id}/pos`, payload || {});
}

let legacySearcherPromise = null;
let legacySearcherReady = null;

async function loadExtensionJson(path) {
  const response = await fetch(chrome.runtime.getURL(path));
  if (!response.ok) throw new Error(path);
  return response.json();
}

/** Cùng cách file cũ: đọc bảng từ package extension, không phụ thuộc server POS. */
async function legacySearcher() {
  if (legacySearcherReady) return legacySearcherReady;
  if (!legacySearcherPromise) {
    legacySearcherPromise = (async () => {
      const [mapping, rows] = await Promise.all([
        loadExtensionJson('data/ward_mapping_2025.json'),
        loadExtensionJson('data/address-select.json'),
      ]);
      legacySearcherReady = createLegacySearcher(mapping, rows);
      return legacySearcherReady;
    })().catch((error) => {
      legacySearcherPromise = null;
      legacySearcherReady = null;
      throw error;
    });
  }
  return legacySearcherPromise;
}

function warmLegacySearcher() {
  return legacySearcher()
    .then((searcher) => ({ ok: true, ready: true, size: searcher.size }))
    .catch(() => ({ ok: false, ready: false, size: 0 }));
}

async function lookupChatPhone(channel, chatId) {
  const params = new URLSearchParams({ channel, chatId });
  return adminFetchJson(`/admin/orders/chat-phone?${params.toString()}`);
}

async function saveChatPhone(channel, chatId, phone) {
  if (typeof channel !== 'string' || typeof chatId !== 'string' || typeof phone !== 'string') {
    return { ok: false, error: 'Thiếu kênh, chat hoặc SĐT.' };
  }
  return withCsrfPost('/admin/orders/chat-phone', { channel, chatId, phone });
}

async function listPendingChatPhones() {
  return adminFetchJson('/admin/orders/chat-phone-pending');
}

async function dismissPendingChatPhone(channel, chatId) {
  if (typeof channel !== 'string' || typeof chatId !== 'string') {
    return { ok: false, error: 'Thiếu kênh hoặc chat.' };
  }
  return withCsrfPost('/admin/orders/chat-phone-pending', { channel, chatId });
}

async function phoneSavedStatus(phones) {
  if (!Array.isArray(phones) || phones.length === 0) {
    return { ok: true, items: [] };
  }
  return withCsrfPost('/admin/orders/phone-saved-status', { phones });
}

async function ensureDefaults() {
  const stored = await chrome.storage.sync.get(['posUrl', 'overlayOpen', 'overlayWidth']);
  const patch = {};
  if (!stored.posUrl) patch.posUrl = DEFAULT_POS_URL;
  if (stored.overlayOpen === undefined) patch.overlayOpen = true;
  if (stored.overlayWidth === undefined) patch.overlayWidth = 400;
  if (Object.keys(patch).length) await chrome.storage.sync.set(patch);
  if (chrome.sidePanel?.setPanelBehavior) {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  }
}

async function notifySessionTabs() {
  const tabs = await chrome.tabs.query({
    url: ['https://pancake.vn/vongdautambyvui*', 'https://chat.zalo.me/*'],
  });
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'vdt-session-changed' });
    } catch {
      /* tab chưa có content script */
    }
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureDefaults();
  void warmLegacySearcher();
});

chrome.runtime.onStartup?.addListener(() => {
  void ensureDefaults();
  void warmLegacySearcher();
});

chrome.cookies.onChanged.addListener((change) => {
  if (change.cookie.name !== SESSION_COOKIE) return;
  // Bỏ qua cookie partition do chính extension ghi — chỉ bắt login/logout tab admin.
  if (change.cookie.partitionKey) return;
  void notifySessionTabs();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'vdt-get-pos-url') {
    getPosUrl().then((posUrl) => sendResponse({ posUrl }));
    return true;
  }
  if (message?.type === 'vdt-sync-session') {
    const pageUrl = message.pageUrl || sender.tab?.url || '';
    if (!pageUrl) {
      sendResponse({ ok: false, reason: 'no-page' });
      return false;
    }
    syncSessionToPage(pageUrl).then(sendResponse);
    return true;
  }
  if (message?.type === 'vdt-legacy-warmup') {
    warmLegacySearcher().then(sendResponse);
    return true;
  }
  if (message?.type === 'vdt-legacy-search' && typeof message.query === 'string') {
    legacySearcher()
      .then((searcher) => sendResponse({ ok: true, ready: true, ...searcher.search(message.query) }))
      .catch(() => sendResponse({ ok: false, ready: false, items: [], more: false }));
    return true;
  }
  if (message?.type === 'vdt-legacy-tree') {
    legacySearcher()
      .then((searcher) => sendResponse({ ok: true, tree: searcher.tree }))
      .catch(() => sendResponse({ ok: false, tree: null }));
    return true;
  }
  if (message?.type === 'vdt-legacy-resolve' && message.selection) {
    legacySearcher()
      .then((searcher) => {
        const item = searcher.resolveManual(message.selection);
        sendResponse({ ok: Boolean(item), item: item || null });
      })
      .catch(() => sendResponse({ ok: false, item: null }));
    return true;
  }
  if (message?.type === 'vdt-pos-bootstrap') {
    posBootstrap({ force: Boolean(message.force) }).then(sendResponse);
    return true;
  }
  if (message?.type === 'vdt-pos-bootstrap-peek') {
    posBootstrapPeek().then(sendResponse);
    return true;
  }
  if (message?.type === 'vdt-pos-bootstrap-warm') {
    // Chỉ warm catalog — không nạp ward_mapping (~1MB) để lần đầu không bị chặn.
    void posBootstrap();
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === 'vdt-pos-create') {
    posCreate(message.payload).then(sendResponse);
    return true;
  }
  if (message?.type === 'vdt-lookup-phone' && typeof message.phone === 'string') {
    lookupPhone(message.phone).then(sendResponse);
    return true;
  }
  if (message?.type === 'vdt-update-order-lines' && message.orderId != null) {
    updateOrderLines(message.orderId, message.lines).then(sendResponse);
    return true;
  }
  if (message?.type === 'vdt-delete-order' && message.orderId != null) {
    deleteOrderById(message.orderId).then(sendResponse);
    return true;
  }
  if (message?.type === 'vdt-pos-order-get' && message.orderId != null) {
    getPosOrder(message.orderId).then(sendResponse);
    return true;
  }
  if (message?.type === 'vdt-pos-order-update' && message.orderId != null) {
    updatePosOrder(message.orderId, message.payload).then(sendResponse);
    return true;
  }
  if (
    message?.type === 'vdt-lookup-chat-phone' &&
    typeof message.channel === 'string' &&
    typeof message.chatId === 'string'
  ) {
    lookupChatPhone(message.channel, message.chatId).then(sendResponse);
    return true;
  }
  if (
    message?.type === 'vdt-save-chat-phone' &&
    typeof message.channel === 'string' &&
    typeof message.chatId === 'string' &&
    typeof message.phone === 'string'
  ) {
    saveChatPhone(message.channel, message.chatId, message.phone).then(sendResponse);
    return true;
  }
  if (message?.type === 'vdt-pending-chat-phones') {
    listPendingChatPhones().then(sendResponse);
    return true;
  }
  if (
    message?.type === 'vdt-dismiss-pending-chat' &&
    typeof message.channel === 'string' &&
    typeof message.chatId === 'string'
  ) {
    dismissPendingChatPhone(message.channel, message.chatId).then(sendResponse);
    return true;
  }
  if (message?.type === 'vdt-phone-saved-status' && Array.isArray(message.phones)) {
    phoneSavedStatus(message.phones).then(sendResponse);
    return true;
  }
  if (message?.type === 'vdt-open-login') {
    getPosUrl().then(async (posUrl) => {
      const origin = new URL(posUrl).origin;
      const loginUrl = `${origin}/admin/login?next=${encodeURIComponent('/admin/orders/pos')}`;
      await chrome.tabs.create({ url: loginUrl, active: true });
      sendResponse({ ok: true });
    });
    return true;
  }
  return undefined;
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'vdt-toggle-overlay' });
  } catch {
    if (chrome.sidePanel?.open) {
      try {
        await chrome.sidePanel.open({ tabId: tab.id });
      } catch {
        const url = await getPosUrl();
        const width = 420;
        const height = Math.min(900, 800);
        const left = Math.max(0, 1280 - width);
        await chrome.windows.create({ url, type: 'popup', width, height, left, top: 0 });
      }
    }
  }
});

void ensureDefaults();
void posBootstrap().catch(() => null);
