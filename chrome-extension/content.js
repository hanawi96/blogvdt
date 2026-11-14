const ROOT_ID = 'vdt-pos-overlay-root';
const STORAGE_OPEN = 'overlayOpen';
const STORAGE_WIDTH = 'overlayWidth';
const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 300;
const MAX_WIDTH = 720;
const PHONE_RE = /(?:\+?84|0)\d{8,10}/;

/** @type {Map<string, object>} */
const lookupCache = new Map();
let lastConvId = '';
let lastPhone = '';
let debounceTimer = 0;
let posOrigin = '';
let posReady = false;
let loginUrl = '';

function clampWidth(value) {
  const max = Math.min(MAX_WIDTH, Math.floor(window.innerWidth * 0.85));
  const min = Math.min(MIN_WIDTH, max);
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_WIDTH;
  return Math.min(max, Math.max(min, n));
}

function applyWidth(root, width) {
  root.style.setProperty('--vdt-width', `${clampWidth(width)}px`);
}

function normalizePhone(raw) {
  const compact = String(raw || '').replace(/[\s.\-()]/g, '');
  const local = compact.startsWith('+84')
    ? `0${compact.slice(3)}`
    : compact.startsWith('84') && compact.length >= 11
      ? `0${compact.slice(2)}`
      : compact;
  return /^0\d{9,10}$/.test(local) ? local : null;
}

function money(amount) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(amount);
}

function dayLabel(timestamp) {
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit' }).format(new Date(timestamp));
}

function selectedConversationId() {
  const item = document.querySelector('.conversation-list-item.selected');
  if (!(item instanceof HTMLElement)) return '';
  const wrap = item.closest('[id]');
  return wrap?.id || item.id || '';
}

function readPancakePhone() {
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
    const text = node.textContent || '';
    const match = text.match(PHONE_RE);
    if (!match) continue;
    const phone = normalizePhone(match[0]);
    if (phone) return phone;
  }
  return null;
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
    handle.releasePointerCapture?.(event.pointerId);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    applyWidth(root, latest);
    void chrome.storage.sync.set({ [STORAGE_WIDTH]: clampWidth(latest) });
  };

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.preventDefault();
    dragging = true;
    startX = event.clientX;
    startWidth = clampWidth(parseFloat(getComputedStyle(root).getPropertyValue('--vdt-width')) || DEFAULT_WIDTH);
    latest = startWidth;
    root.classList.add('is-resizing');
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
  box.hidden = false;
  box.dataset.state = 'status';
  box.innerHTML = `<p class="vdt-customer-status">${text}</p>`;
}

function renderCustomer(root, customer) {
  const box = customerBox(root);
  if (!(box instanceof HTMLElement)) return;
  const recent = customer.recent;
  if (!recent) {
    setCustomerStatus(root, `Có ${customer.orderCount} đơn · chưa đọc được đơn gần nhất`);
    return;
  }
  const product = recent.optionLabel ? `${recent.productName} · ${recent.optionLabel}` : recent.productName;
  box.hidden = false;
  box.dataset.state = 'order';
  box.innerHTML = `
    <div class="vdt-customer-row">
      <span class="vdt-pill vdt-pill-status">${escapeHtml(recent.fulfillLabel || recent.statusLabel)}</span>
      <span class="vdt-pill vdt-pill-phone">${escapeHtml(customer.phone)}</span>
      <span class="vdt-date">${escapeHtml(dayLabel(recent.createdAt))}</span>
      <button type="button" class="vdt-copy" data-vdt-copy="${escapeAttr(customer.phone)}" title="Sao chép SĐT" aria-label="Sao chép SĐT">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/></svg>
      </button>
    </div>
    <div class="vdt-customer-meta">
      ${customer.provinceLabel ? `<span class="vdt-pill vdt-pill-place">${escapeHtml(customer.provinceLabel)}</span>` : ''}
      <strong class="vdt-price">${escapeHtml(money(recent.totalPrice))}</strong>
      <span class="vdt-product">${escapeHtml(product)}</span>
    </div>
  `;
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

function postToPos(payload) {
  const root = document.getElementById(ROOT_ID);
  const frame = root?.querySelector('.vdt-frame');
  if (!(frame instanceof HTMLIFrameElement) || !frame.contentWindow) return;
  frame.contentWindow.postMessage({ source: 'vdt-ext', ...payload }, posOrigin || '*');
}

function requestLookup(phone, convId) {
  const root = ensureRoot();
  const cached = lookupCache.get(phone);
  if (cached) {
    renderCustomer(root, cached);
    postToPos({ type: 'vdt-fill-phone', phone });
    return;
  }
  setCustomerStatus(root, `Đang tra ${phone}…`);
  chrome.runtime.sendMessage({ type: 'vdt-lookup-phone', phone }, (result) => {
    if (chrome.runtime.lastError) {
      setCustomerStatus(root, 'Không tra được khách.');
      return;
    }
    if (selectedConversationId() !== convId && convId) return;
    if (result?.error === 'auth') {
      loginUrl = result.loginUrl || loginUrl;
      setAuthBanner(root, true);
      setCustomerStatus(root, 'Cần đăng nhập admin để tra đơn.');
      return;
    }
    if (!result?.ok) {
      setCustomerStatus(root, result?.error || 'Không tra được khách.');
      return;
    }
    setAuthBanner(root, false);
    if (!result.found || !result.customer) {
      setCustomerStatus(root, `Chưa có đơn với ${phone}`);
      postToPos({ type: 'vdt-fill-phone', phone });
      return;
    }
    lookupCache.set(phone, result.customer);
    renderCustomer(root, result.customer);
    postToPos({ type: 'vdt-fill-phone', phone });
  });
}

function syncFromPage() {
  const root = ensureRoot();
  const convId = selectedConversationId();
  const phone = readPancakePhone();

  if (!phone) {
    if (convId && convId !== lastConvId) {
      lastConvId = convId;
      lastPhone = '';
      setCustomerStatus(root, 'Chưa thấy SĐT trên Pancake');
    } else if (!convId) {
      lastConvId = '';
      lastPhone = '';
      const box = customerBox(root);
      if (box instanceof HTMLElement) box.hidden = true;
    }
    return;
  }

  if (phone === lastPhone && convId === lastConvId) return;
  lastPhone = phone;
  lastConvId = convId;
  requestLookup(phone, convId);
}

function scheduleSync() {
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(syncFromPage, 280);
}

function watchPancake() {
  if (!location.hostname.includes('pancake.vn')) return;
  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.conversation-list-item, .body-conver-item, .name-module')) scheduleSync();
    },
    true,
  );
  scheduleSync();
}

async function preparePosFrame(frame, { forceReload = false } = {}) {
  const sync = await chrome.runtime.sendMessage({ type: 'vdt-sync-session', pageUrl: location.href });
  const root = ensureRoot();
  if (!sync?.ok) {
    loginUrl = sync?.loginUrl || loginUrl;
    setAuthBanner(root, true);
  } else {
    setAuthBanner(root, false);
  }

  const url = sync?.posUrl || (await chrome.runtime.sendMessage({ type: 'vdt-get-pos-url' }))?.posUrl;
  if (!url || !(frame instanceof HTMLIFrameElement)) return;
  posOrigin = new URL(url).origin;
  if (!frame.src || forceReload || frame.src !== url) {
    posReady = false;
    frame.src = url;
  } else if (forceReload) {
    posReady = false;
    frame.src = url;
  }
}

function ensureRoot() {
  let root = document.getElementById(ROOT_ID);
  if (root) return root;

  root = document.createElement('div');
  root.id = ROOT_ID;
  root.innerHTML = `
    <div class="vdt-shell" role="complementary" aria-label="Tạo đơn nhanh">
      <div class="vdt-resizer" role="separator" aria-orientation="vertical" aria-label="Kéo chỉnh độ rộng" title="Kéo để chỉnh độ rộng"></div>
      <div class="vdt-bar">
        <strong>Tạo đơn nhanh</strong>
        <div class="vdt-bar-actions">
          <button type="button" data-vdt-reload title="Tải lại">Tải lại</button>
          <button type="button" data-vdt-collapse title="Thu gọn">Thu</button>
        </div>
      </div>
      <div class="vdt-auth" data-vdt-auth hidden>
        <p data-vdt-auth-text>Chưa đăng nhập admin. Đăng nhập trên trang quản trị một lần — sidebar dùng chung phiên.</p>
        <div class="vdt-auth-actions">
          <button type="button" data-vdt-login>Mở đăng nhập</button>
          <button type="button" data-vdt-resync>Đã đăng nhập — tải lại</button>
        </div>
      </div>
      <div class="vdt-customer" data-vdt-customer hidden></div>
      <iframe class="vdt-frame" title="Tạo đơn POS" allow="clipboard-read; clipboard-write"></iframe>
    </div>
    <button type="button" class="vdt-tab" data-vdt-expand title="Mở tạo đơn">Tạo đơn</button>
  `;
  document.documentElement.appendChild(root);

  const frame = root.querySelector('.vdt-frame');
  root.querySelector('[data-vdt-collapse]')?.addEventListener('click', () => setOpen(false));
  root.querySelector('[data-vdt-expand]')?.addEventListener('click', () => setOpen(true));
  root.querySelector('[data-vdt-reload]')?.addEventListener('click', () => {
    void preparePosFrame(frame, { forceReload: true });
  });
  root.querySelector('[data-vdt-login]')?.addEventListener('click', () => {
    void chrome.runtime.sendMessage({ type: 'vdt-open-login' });
  });
  root.querySelector('[data-vdt-resync]')?.addEventListener('click', () => {
    void preparePosFrame(frame, { forceReload: true }).then(() => scheduleSync());
  });
  root.addEventListener('click', (event) => {
    const btn = event.target instanceof Element ? event.target.closest('[data-vdt-copy]') : null;
    if (!(btn instanceof HTMLButtonElement)) return;
    const phone = btn.dataset.vdtCopy || '';
    if (!phone) return;
    void navigator.clipboard?.writeText(phone);
  });
  bindResize(root);

  return root;
}

async function setOpen(open) {
  const root = ensureRoot();
  root.classList.toggle('is-collapsed', !open);
  await chrome.storage.sync.set({ [STORAGE_OPEN]: open });
}

async function mount() {
  const root = ensureRoot();
  const frame = root.querySelector('.vdt-frame');
  const stored = await chrome.storage.sync.get([STORAGE_OPEN, STORAGE_WIDTH]);
  applyWidth(root, stored[STORAGE_WIDTH] ?? DEFAULT_WIDTH);
  const open = stored[STORAGE_OPEN] !== false;
  root.classList.toggle('is-collapsed', !open);

  await preparePosFrame(frame);

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.source !== 'vdt-pos') return;
    if (posOrigin && event.origin !== posOrigin) return;
    if (data.type === 'vdt-pos-ready') {
      posReady = true;
      scheduleSync();
    }
  });

  watchPancake();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
    void preparePosFrame(frame, { forceReload: true }).then(() => {
      lookupCache.clear();
      lastPhone = '';
      scheduleSync();
      sendResponse({ ok: true });
    });
    return true;
  }
  return undefined;
});

void mount();
