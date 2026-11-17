const ROOT_ID = 'vdt-pos-overlay-root';
const STORAGE_OPEN = 'overlayOpen';
const STORAGE_WIDTH = 'overlayWidth';
const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 300;
const MAX_WIDTH = 720;
const POS_URL_CACHE_KEY = 'posUrlCached';
const PHONE_RE = /(?:\+?84|0)\d{8,10}/;

/** @type {Map<string, object>} */
const lookupCache = new Map();
/** @type {Map<string, string>} channel:chatId → phone (cache phiên) */
const chatPhoneCache = new Map();
/** @type {Set<string>} */
const chatLookupPending = new Set();
/** @type {object | null} */
let activeCustomer = null;
/** @type {{ lineIndex: number, mode: 'weight' | 'qty', extraOpen?: boolean } | null} */
let customerEditUi = null;
let customerSaving = false;
let customerDeleteConfirm = false;
let customerCanDelete = false;
let lastConvId = '';
let lastPhone = '';
let lastName = '';
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

function isPancake() {
  return location.hostname.includes('pancake.vn');
}

function isZalo() {
  return location.hostname.includes('zalo.me');
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

function selectedConversationId() {
  if (isPancake()) {
    const item = document.querySelector('.conversation-list-item.selected');
    if (item instanceof HTMLElement) {
      const wrap = item.closest('[id]');
      const fromDom =
        wrap?.id ||
        item.id ||
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
    const thread =
      document.querySelector('.threadChat[id]') ||
      document.querySelector('[data-id].threadChat') ||
      document.querySelector('.main-chat-container [id]');
    if (thread instanceof HTMLElement) {
      const id = thread.id || thread.getAttribute('data-id');
      if (id) return String(id).slice(0, 191);
    }
    const title =
      document.querySelector('.threadChat__title .header-title') ||
      document.querySelector('.threadChat .header-title') ||
      document.querySelector('.threadChat__title');
    const name = cleanName(title?.textContent);
    return name ? `zalo:${name}` : '';
  }
  return '';
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
    const text = node.textContent || '';
    const match = text.match(PHONE_RE);
    if (!match) continue;
    const phone = normalizePhone(match[0]);
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

/** SĐT trong bubble hội thoại đang mở (không lấy list bên / API ngầm). */
function readPhoneFromVisibleMessages() {
  const listSel =
    '.conversation-list, .conversation-list-item, .body-conver-item, [class*="conversation-list"], .conv-item, .left-nav';
  let found = null;
  for (const node of document.querySelectorAll(MESSAGE_BUBBLE_SELECTOR)) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.closest(`#${ROOT_ID}`)) continue;
    if (node.closest(listSel)) continue;
    const text = node.innerText || node.textContent || '';
    if (text.length > 2000) continue;
    const matches = text.match(new RegExp(PHONE_RE.source, 'g'));
    if (!matches) continue;
    for (const raw of matches) {
      const phone = normalizePhone(raw);
      if (phone) found = phone;
    }
  }
  return found;
}

/**
 * Chỉ lấy SĐT đáng tin cho header:
 * tag SĐT trên panel Pancake hoặc số đang hiện trong tin nhắn.
 * Không dùng SĐT bắt từ JSON API toàn cục (dễ lấy nhầm hội thoại khác).
 */
function readTrustedPhone() {
  return readPancakePhone() || readPhoneFromVisibleMessages();
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

function requestChatPhoneMap(channel, chatId, name) {
  const key = chatCacheKey(channel, chatId);
  if (chatPhoneCache.has(key) || chatLookupPending.has(key)) return;
  chatLookupPending.add(key);
  void runtimeSend({ type: 'vdt-lookup-chat-phone', channel, chatId }).then((result) => {
    chatLookupPending.delete(key);
    if (!result || !isExtensionAlive()) return;
    if (selectedConversationId() !== chatId) return;
    if (result.error === 'auth') {
      const root = ensureRoot();
      loginUrl = result.loginUrl || loginUrl;
      setAuthBanner(root, true);
      return;
    }
    if (!result.ok || !result.found || !result.phone) return;
    const phone = normalizePhone(result.phone);
    if (!phone) return;
    rememberChatPhone(channel, chatId, phone);
    // Chỉ điền form im lặng — không hiện «Chưa có đơn với…» từ map cũ (có thể lệch).
    postCustomerFill({ phone, name: name || '', channel, chatId });
  });
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

function renderLineEditor(line, index, editable) {
  const open = customerEditUi && customerEditUi.lineIndex === index ? customerEditUi : null;
  const weight = String(line.weight || '').trim();
  const qty = clampLineQty(line.quantity);
  const chips = Array.isArray(line.chips) ? line.chips : [];
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
    const extraOpen = Boolean(open.extraOpen) || (weight && extras.includes(weight) && !chips.includes(weight));
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

  return `<div class="vdt-line" data-vdt-line-row="${index}">
    <div class="vdt-line-main">
      <span class="vdt-product">${escapeHtml(line.productName || '')}</span>
      ${weightPill}
      ${qtyPill}
    </div>
    ${editor}
  </div>`;
}

function renderCustomer(root, customer) {
  const box = customerBox(root);
  if (!(box instanceof HTMLElement)) return;
  const recent = customer.recent;
  if (!recent) {
    activeCustomer = null;
    customerEditUi = null;
    setCustomerStatus(root, `Có ${customer.orderCount} đơn · chưa đọc được đơn gần nhất`);
    return;
  }
  activeCustomer = customer;
  const status = recent.fulfillLabel || recent.statusLabel || '';
  const place = shortProvince(customer.provinceLabel);
  const editable = Boolean(recent.editable);
  const lines = customerLinesOf(recent);
  const canDelete = Boolean(customerCanDelete);
  const deleteBusy = customerSaving && customerDeleteConfirm;
  box.hidden = false;
  box.dataset.state = 'order';
  const lineSaving = customerSaving && !customerDeleteConfirm;
  box.classList.toggle('is-saving', lineSaving);
  box.innerHTML = `
    <div class="vdt-customer-card${editable ? ' is-editable' : ''}${lineSaving ? ' is-saving' : ''}${customerDeleteConfirm ? ' is-confirm-delete' : ''}">
      <div class="vdt-customer-row">
        <span class="vdt-pill vdt-pill-status">${escapeHtml(status)}</span>
        <span class="vdt-pill vdt-pill-phone">${escapeHtml(customer.phone)}</span>
        <span class="vdt-date">${escapeHtml(dayLabel(recent.createdAt))}</span>
        <div class="vdt-customer-actions">
          <button type="button" class="vdt-copy" data-vdt-duplicate-order title="Nhân bản đơn" aria-label="Nhân bản đơn">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/></svg>
          </button>
          ${
            editable
              ? `<button type="button" class="vdt-edit" data-vdt-edit-order title="Sửa đơn" aria-label="Sửa đơn" ${customerSaving ? 'disabled' : ''}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                </button>`
              : ''
          }
          ${
            canDelete
              ? `<button type="button" class="vdt-delete" data-vdt-delete-order title="Xóa đơn" aria-label="Xóa đơn" ${customerSaving ? 'disabled' : ''}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M7 7l1 13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-13"/><path d="M10 11v6M14 11v6"/></svg>
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
      <div class="vdt-lines">${lines.map((line, index) => renderLineEditor(line, index, editable)).join('')}</div>
    </div>
  `;
}

function patchCustomerFromOrder(order) {
  if (!activeCustomer?.recent || !order) return;
  const recent = activeCustomer.recent;
  recent.totalPrice = Number(order.totalPrice) || recent.totalPrice;
  recent.quantity = Number(order.quantity) || recent.quantity;
  recent.editable = order.editable !== false;
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
  if (!activeCustomer?.recent?.editable || customerSaving) return;
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

function handleCustomerCardClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const editOpen = target.closest('[data-vdt-edit-order]');
  if (editOpen instanceof HTMLElement) {
    if (!activeCustomer?.recent?.editable || customerSaving) return;
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

  if (!activeCustomer?.recent?.editable || customerSaving || customerDeleteConfirm) return;

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
  if (!activeCustomer?.recent?.editable || customerSaving) return;
  const lineIndex = Number(target.getAttribute('data-vdt-weight-extra'));
  const weight = target.value;
  if (!Number.isInteger(lineIndex) || !weight) return;
  void saveCustomerLines((lines) => {
    if (lines[lineIndex]) lines[lineIndex].weight = weight;
  });
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
      setCustomerStatus(root, `Chưa có đơn với ${phone}`);
      postCustomerFill({ phone, name: name || '', channel, chatId: convId });
      return;
    }
    result.customer.canDelete = customerCanDelete;
    lookupCache.set(phone, result.customer);
    customerEditUi = null;
    customerSaving = false;
    customerDeleteConfirm = false;
    renderCustomer(root, result.customer);
    postCustomerFill({ phone, name: name || '', channel, chatId: convId });
  });
}

function syncFromPage() {
  const root = ensureRoot();
  const channel = chatChannel();
  const convId = selectedConversationId();
  const name = readChatName();
  const trustedPhone = readTrustedPhone();
  const cachedPhone = channel && convId ? chatPhoneCache.get(chatCacheKey(channel, convId)) || null : null;
  // Header chỉ tra đơn theo SĐT tin cậy (tag/bubble); cache chỉ điền form.
  const phoneForHeader = trustedPhone;
  const phoneForFill = trustedPhone || cachedPhone;

  if (name && (name !== lastName || convId !== lastConvId)) {
    postCustomerFill({ name, phone: phoneForFill || undefined, channel, chatId: convId });
    lastName = name;
  }

  if (trustedPhone && channel && convId) rememberChatPhone(channel, convId, trustedPhone);

  if (!phoneForHeader) {
    if (convId && channel) {
      requestChatPhoneMap(channel, convId, name || '');
      if (convId !== lastConvId) {
        lastConvId = convId;
        lastPhone = '';
        const box = customerBox(root);
        if (box instanceof HTMLElement) {
          box.hidden = true;
          box.innerHTML = '';
          delete box.dataset.state;
        }
      }
    } else if (!convId) {
      lastConvId = '';
      lastPhone = '';
      lastName = '';
      const box = customerBox(root);
      if (box instanceof HTMLElement) {
        box.hidden = true;
        box.innerHTML = '';
        delete box.dataset.state;
      }
    }
    return;
  }

  if (phoneForHeader === lastPhone && convId === lastConvId) return;
  lastPhone = phoneForHeader;
  lastConvId = convId;
  requestLookup(phoneForHeader, convId, name || '');
}

function scheduleSync() {
  if (!isExtensionAlive()) return;
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    if (!isExtensionAlive()) return;
    try {
      syncFromPage();
    } catch {
      /* DOM/extension race */
    }
  }, 280);
}

function showToast(text) {
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
  const match = String(text || '').match(PHONE_RE);
  return match ? normalizePhone(match[0]) : null;
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
  if (phone && channel && chatId) rememberChatPhone(channel, chatId, phone);
  if (phone) {
    postCustomerFill({ phone, channel, chatId });
  }

  void setOpen(true);
  const root = ensureRoot();
  const frame = root.querySelector('.vdt-frame');
  if (frame instanceof HTMLIFrameElement) void preparePosFrame(frame);

  showToast('Đang nhận diện địa chỉ…');
  const data = await legacySearchReliable(address);
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
      postToPos({
        type: 'vdt-fill-address',
        address: composed || address,
        provinceCode: hit.provinceCode,
        wardCode: hit.wardCode,
        line,
        phone: phone || undefined,
        matched: true,
        channel: channel || undefined,
        chatId: chatId || undefined,
      });
      showToast(posReady ? `Đã điền: ${hit.newText}` : 'Đã gửi địa chỉ — đợi form tải xong');
      return;
    }
    // Nhiều kết quả khác nhau → đưa vào ô tìm địa chỉ cũ để chọn.
    logAddrDebug('need-pick', { count: data.items.length, reason: 'ambiguous' });
    postToPos({
      type: 'vdt-fill-address',
      address,
      phone: phone || undefined,
      matched: false,
      needPick: true,
      legacyQuery: address,
      legacyItems: data.items.slice(0, 8),
      channel: channel || undefined,
      chatId: chatId || undefined,
    });
    showToast(`Có ${data.items.length} chỗ khớp — chọn trong form`);
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
  for (const node of document.querySelectorAll(MESSAGE_BUBBLE_SELECTOR)) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.closest(`#${ROOT_ID}`)) continue;
    if (node.closest(`[${ADDR_BTN_ATTR}]`)) continue;
    const text = normalizeMessageText(node);
    if (!looksLikeAddressText(text)) continue;
    candidates.push(node);
  }
  return candidates.filter((node) => !candidates.some((other) => other !== node && node.contains(other)));
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
  btn.title = 'Nhận địa chỉ vào form đơn';
  btn.setAttribute('aria-label', 'Nhận địa chỉ vào form đơn');
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-5.3 7-11a7 7 0 1 0-14 0c0 5.7 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>';
  btn.addEventListener(
    'click',
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      const address = normalizeMessageText(host);
      if (!looksLikeAddressText(address)) {
        showToast('Không thấy địa chỉ trong tin này');
        return;
      }
      void applyAddressFromChat(address);
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
  });
  chatObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
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
      }
    },
    true,
  );
  scheduleSync();
  scheduleAddressScan();
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
      <iframe class="vdt-frame" title="Tạo đơn POS" loading="eager" allow="clipboard-read; clipboard-write"></iframe>
    </div>
    <button type="button" class="vdt-tab" data-vdt-expand title="Mở tạo đơn">Tạo đơn</button>
  `;
  document.documentElement.appendChild(root);

  const frame = root.querySelector('.vdt-frame');
  root.querySelector('[data-vdt-collapse]')?.addEventListener('click', () => setOpen(false));
  root.querySelector('[data-vdt-expand]')?.addEventListener('click', () => setOpen(true));
  root.querySelector('[data-vdt-reload]')?.addEventListener('click', () => {
    panelReady = false;
    posReady = false;
    root.classList.add('is-booting');
    if (desiredOpen) root.classList.add('is-collapsed');
    void preparePosFrame(frame, { forceReload: true });
  });
  root.querySelector('[data-vdt-login]')?.addEventListener('click', () => {
    void runtimeSend({ type: 'vdt-open-login' });
  });
  root.querySelector('[data-vdt-resync]')?.addEventListener('click', () => {
    void preparePosFrame(frame, { forceReload: true }).then(() => scheduleSync());
  });
  root.addEventListener('click', (event) => {
    const duplicateOrder = event.target instanceof Element ? event.target.closest('[data-vdt-duplicate-order]') : null;
    if (duplicateOrder instanceof HTMLButtonElement) {
      duplicateActiveOrder();
      return;
    }
    handleCustomerCardClick(event);
  });
  root.addEventListener('change', handleCustomerCardChange);
  bindResize(root);

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
  await storageSet('sync', { [STORAGE_OPEN]: desiredOpen });
}

async function mount() {
  if (!isExtensionAlive()) return;
  // Shell dựng sớm nhưng ẩn (is-booting) đến khi panel báo sẵn sàng + có form.
  const root = ensureRoot();
  const frame = root.querySelector('.vdt-frame');
  root.classList.add('is-booting');
  root.classList.add('is-collapsed');

  window.addEventListener('message', (event) => {
    if (!isExtensionAlive()) return;
    const data = event.data;
    if (!data || data.source !== 'vdt-pos') return;
    if (posOrigin && event.origin !== posOrigin) return;
    if (data.type === 'vdt-pos-ready') {
      posReady = true;
      panelReady = true;
      flushPendingPosMessages();
      revealOverlayIfReady();
      scheduleSync();
      return;
    }
    if (data.type === 'vdt-order-updated') {
      const phone = typeof data.phone === 'string' ? data.phone.trim() : '';
      if (!phone) return;
      lookupCache.delete(phone);
      showToast('Đã cập nhật đơn.');
      if (phone === lastPhone) {
        lastPhone = '';
        requestLookup(phone, lastConvId, lastName || '');
      }
    }
  });

  const storedPromise = storageGet('sync', [STORAGE_OPEN, STORAGE_WIDTH]);
  const preparePromise = preparePosFrame(frame);
  watchChatPages();

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
        lastPhone = '';
        lastName = '';
        scheduleSync();
        sendResponse({ ok: true });
      });
      return true;
    }
    return undefined;
  });
} catch {
  markExtensionDead();
}

void mount();
