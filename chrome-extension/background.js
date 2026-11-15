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

function topLevelSiteOf(pageUrl) {
  const url = new URL(pageUrl);
  return `${url.protocol}//${url.hostname}`;
}

/** Cookie đăng nhập tab admin (first-party, không partition). */
async function readAdminSessionCookie(posUrl) {
  const cookie = await chrome.cookies.get({
    url: posUrl,
    name: SESSION_COOKIE,
  });
  return cookie?.value ? cookie : null;
}

/**
 * Đồng bộ session admin vào cookie partition của trang chat (Pancake/Zalo)
 * để iframe POS nhận cùng phiên — không bắt đăng nhập lại trong sidebar.
 */
async function syncSessionToPage(pageUrl) {
  const posUrl = await getPosUrl();
  const origin = new URL(posUrl).origin;
  const topLevelSite = topLevelSiteOf(pageUrl);
  const cookie = await readAdminSessionCookie(posUrl);
  if (!cookie) return { ok: false, reason: 'no-session', posUrl, loginUrl: `${origin}/admin/login?next=${encodeURIComponent('/admin/orders/pos')}` };

  const details = {
    url: `${origin}/`,
    name: SESSION_COOKIE,
    value: cookie.value,
    path: cookie.path || '/',
    secure: true,
    httpOnly: true,
    sameSite: 'no_restriction',
    expirationDate: cookie.expirationDate,
    partitionKey: { topLevelSite },
  };
  if (!cookie.hostOnly && cookie.domain) details.domain = cookie.domain;

  await chrome.cookies.set(details);
  return { ok: true, posUrl, topLevelSite };
}

async function adminFetchJson(pathWithQuery) {
  const posUrl = await getPosUrl();
  const origin = new URL(posUrl).origin;
  const cookie = await readAdminSessionCookie(posUrl);
  if (!cookie) {
    return {
      ok: false,
      error: 'auth',
      loginUrl: `${origin}/admin/login?next=${encodeURIComponent('/admin/orders/pos')}`,
    };
  }
  const response = await fetch(`${origin}${pathWithQuery}`, {
    credentials: 'include',
    headers: { accept: 'application/json' },
    redirect: 'manual',
  });
  if (response.type === 'opaqueredirect' || response.status === 301 || response.status === 302 || response.status === 303) {
    return { ok: false, error: 'auth', loginUrl: `${origin}/admin/login?next=${encodeURIComponent('/admin/orders/pos')}` };
  }
  if (!response.ok) {
    try {
      return await response.json();
    } catch {
      return { ok: false, error: 'Không tra được dữ liệu.' };
    }
  }
  return response.json();
}

async function lookupPhone(phone) {
  return adminFetchJson(`/admin/orders/lookup?phone=${encodeURIComponent(phone)}`);
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
    url: ['https://pancake.vn/*', 'https://*.pancake.vn/*', 'https://chat.zalo.me/*'],
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
  if (message?.type === 'vdt-lookup-phone' && typeof message.phone === 'string') {
    lookupPhone(message.phone).then(sendResponse);
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
