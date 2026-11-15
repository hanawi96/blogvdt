const ROOT_ID = 'vdt-pos-overlay-root';
const STORAGE_OPEN = 'overlayOpen';
const STORAGE_WIDTH = 'overlayWidth';
const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 300;
const MAX_WIDTH = 720;
const PHONE_RE = /(?:\+?84|0)\d{8,10}/;

/** @type {Map<string, object>} */
const lookupCache = new Map();
/** @type {Map<string, string>} channel:chatId → phone (cache phiên) */
const chatPhoneCache = new Map();
/** @type {Set<string>} */
const chatLookupPending = new Set();
let lastConvId = '';
let lastPhone = '';
let lastName = '';
let debounceTimer = 0;
let posOrigin = '';
let posReady = false;
let loginUrl = '';
/** @type {string | null} */
let hookPhone = null;
/** @type {object[]} */
let pendingPosMessages = [];

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

/** Ưu tiên: DOM tag Pancake → SĐT bắt từ API (page-hook) → cache map đã biết. */
function readVisibleOrHookPhone() {
  return readPancakePhone() || hookPhone;
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
  chrome.runtime.sendMessage({ type: 'vdt-lookup-chat-phone', channel, chatId }, (result) => {
    chatLookupPending.delete(key);
    if (chrome.runtime.lastError) return;
    if (selectedConversationId() !== chatId) return;
    if (result?.error === 'auth') {
      const root = ensureRoot();
      loginUrl = result.loginUrl || loginUrl;
      setAuthBanner(root, true);
      return;
    }
    if (!result?.ok || !result.found || !result.phone) return;
    const phone = normalizePhone(result.phone);
    if (!phone) return;
    rememberChatPhone(channel, chatId, phone);
    if (phone === lastPhone && chatId === lastConvId) return;
    lastPhone = phone;
    lastConvId = chatId;
    requestLookup(phone, chatId, name || '');
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
    renderCustomer(root, cached);
    postCustomerFill({ phone, name: name || '', channel, chatId: convId });
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
      postCustomerFill({ phone, name: name || '', channel, chatId: convId });
      return;
    }
    lookupCache.set(phone, result.customer);
    renderCustomer(root, result.customer);
    postCustomerFill({ phone, name: name || '', channel, chatId: convId });
  });
}

function syncFromPage() {
  const root = ensureRoot();
  const channel = chatChannel();
  const convId = selectedConversationId();
  const name = readChatName();
  const cachedPhone = channel && convId ? chatPhoneCache.get(chatCacheKey(channel, convId)) || null : null;
  const phone = readVisibleOrHookPhone() || cachedPhone;

  if (name && (name !== lastName || convId !== lastConvId)) {
    postCustomerFill({ name, phone: phone || undefined, channel, chatId: convId });
    lastName = name;
  }

  if (phone && channel && convId) rememberChatPhone(channel, convId, phone);

  if (!phone) {
    if (convId && channel) {
      requestChatPhoneMap(channel, convId, name || '');
      if (convId !== lastConvId) {
        lastConvId = convId;
        lastPhone = '';
        hookPhone = null;
        if (isPancake()) setCustomerStatus(root, name ? `Nick: ${name} · đang tìm SĐT…` : 'Đang tìm SĐT…');
        else if (isZalo() && name) {
          const box = customerBox(root);
          if (box instanceof HTMLElement) box.hidden = true;
        }
      }
    } else if (!convId) {
      lastConvId = '';
      lastPhone = '';
      lastName = '';
      hookPhone = null;
      const box = customerBox(root);
      if (box instanceof HTMLElement) box.hidden = true;
    }
    return;
  }

  if (phone === lastPhone && convId === lastConvId) return;
  lastPhone = phone;
  lastConvId = convId;
  requestLookup(phone, convId, name || '');
}

function scheduleSync() {
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(syncFromPage, 280);
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

function messageBubbleFrom(target) {
  if (!(target instanceof Element)) return null;
  const bubble = target.closest(
    [
      '[class*="message-content"]',
      '[class*="msg-content"]',
      '[class*="message-text"]',
      '[class*="msg-text"]',
      '[class*="bubble-text"]',
      '[class*="chat-content"]',
      '.text-message',
      '.message-body',
      '[data-contents]',
    ].join(', '),
  );
  if (bubble instanceof HTMLElement) return bubble;
  const loose = target.closest('[class*="message"], [class*="msg-item"], [class*="bubble"]');
  return loose instanceof HTMLElement ? loose : null;
}

function readMessageAddressText(node) {
  const raw = String(node.innerText || node.textContent || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const flat = raw.replace(/\s+/g, ' ');
  if (flat.length < 8 || flat.length > 600) return null;
  const hasPlace =
    /(xã|xa\b|phường|phuong|p\.|p\/|tỉnh|tinh|thành phố|tp\.|tphcm|\bhcm\b|quận|quan|huyện|đường|ngõ|hẻm|ấp)/i.test(flat);
  const hasShortWardDistrict = /(?:^|[^0-9\p{L}])(?:p|ph|q)\.?\s*\d{1,2}\b/iu.test(flat);
  const hasDashedPlace = /\p{L}{2,}(?:\s+\p{L}+){0,3}\s*[-–—]\s*\p{L}{2,}(?:\s+\p{L}+){0,3}\s*[-–—]\s*\p{L}{2,}/u.test(flat);
  const hasPhone = /(?:\+?84|0)[\d.\s-]{8,16}/.test(flat);
  const hasNumber = /\d/.test(flat);
  if (
    !(
      hasPlace ||
      hasShortWardDistrict ||
      hasDashedPlace ||
      (hasNumber && /[,\n]/.test(raw)) ||
      (hasPhone && hasNumber && flat.split(/\s+/).length >= 4)
    )
  ) {
    return null;
  }
  return raw;
}

function readPhoneFromText(text) {
  const match = String(text || '').match(PHONE_RE);
  return match ? normalizePhone(match[0]) : null;
}

function watchChatPages() {
  if (!isPancake() && !isZalo()) return;
  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        target.closest(
          '.conversation-list-item, .body-conver-item, .name-module, .threadChat, .msg-item, .conv-item, [class*="conversation"]',
        )
      ) {
        scheduleSync();
      }
    },
    true,
  );
  document.addEventListener(
    'dblclick',
    (event) => {
      const bubble = messageBubbleFrom(event.target);
      if (!bubble) return;
      const address = readMessageAddressText(bubble);
      if (!address) return;
      event.preventDefault();
      event.stopPropagation();
      void setOpen(true);
      const channel = chatChannel();
      const chatId = selectedConversationId();
      const phone = readPhoneFromText(address);
      if (phone && channel && chatId) rememberChatPhone(channel, chatId, phone);
      // Địa chỉ 3 cấp cũ (vd Bình Dương) → tra bảng ánh xạ trước khi gửi form.
      try {
        chrome.runtime.sendMessage({ type: 'vdt-legacy-search', query: address }, (data) => {
          if (!chrome.runtime.lastError && data?.ok && Array.isArray(data.items) && data.items.length > 0) {
            const hit = data.items[0];
            const samePlace = data.items.every(
              (item) => item.provinceCode === hit.provinceCode && item.wardCode === hit.wardCode,
            );
            if (data.items.length === 1 || samePlace) {
              const line = typeof hit.line === 'string' ? hit.line : '';
              const composed = [line, hit.wardName, hit.provinceName].filter(Boolean).join(', ');
              postToPos({
                type: 'vdt-fill-address',
                address: composed || address,
                provinceCode: hit.provinceCode,
                wardCode: hit.wardCode,
                line,
                chat: false,
                channel: channel || undefined,
                chatId: chatId || undefined,
              });
              showToast(posReady ? `Đã đổi sang ${hit.newText}` : 'Đã gửi địa chỉ — đợi form tải xong');
              return;
            }
          }
          postToPos({
            type: 'vdt-fill-address',
            address,
            channel: channel || undefined,
            chatId: chatId || undefined,
          });
          showToast(posReady ? 'Đã nhận địa chỉ từ tin nhắn' : 'Đã gửi địa chỉ — đợi form tải xong');
        });
      } catch {
        postToPos({
          type: 'vdt-fill-address',
          address,
          channel: channel || undefined,
          chatId: chatId || undefined,
        });
        showToast(posReady ? 'Đã nhận địa chỉ từ tin nhắn' : 'Đã gửi địa chỉ — đợi form tải xong');
      }
    },
    true,
  );
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.source !== 'vdt-page' || data.type !== 'vdt-phones-found') return;
    if (!Array.isArray(data.phones)) return;
    let best = null;
    for (const raw of data.phones) {
      const phone = normalizePhone(raw);
      if (phone) best = phone;
    }
    if (!best || best === hookPhone) return;
    hookPhone = best;
    scheduleSync();
  });
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
  const frameUrl = legacyFrameUrl(url);
  if (!frame.src || forceReload || frame.src !== frameUrl) {
    posReady = false;
    pendingPosMessages = [];
    frame.src = frameUrl;
  }
}

/** Đổi query để iframe tải lại sau khi thêm trả kết quả địa chỉ cũ. */
function legacyFrameUrl(url) {
  try {
    const next = new URL(url);
    next.searchParams.set('vdt', '4');
    return next.toString();
  } catch {
    return url;
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
      flushPendingPosMessages();
      scheduleSync();
    }
  });

  watchChatPages();
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
      chatPhoneCache.clear();
      chatLookupPending.clear();
      lastPhone = '';
      lastName = '';
      hookPhone = null;
      scheduleSync();
      sendResponse({ ok: true });
    });
    return true;
  }
  return undefined;
});

void mount();
