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

async function lookupPhone(phone) {
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
  // Fetch từ extension + host_permissions tự kèm cookie first-party admin_session.
  const response = await fetch(`${origin}/admin/orders/lookup?phone=${encodeURIComponent(phone)}`, {
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
      return { ok: false, error: 'Không tra được khách.' };
    }
  }
  return response.json();
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
});

chrome.runtime.onStartup?.addListener(() => {
  void ensureDefaults();
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
  if (message?.type === 'vdt-lookup-phone' && typeof message.phone === 'string') {
    lookupPhone(message.phone).then(sendResponse);
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
