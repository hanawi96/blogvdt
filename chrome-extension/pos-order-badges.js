/**
 * Badge «đã lưu / chưa lưu» cạnh SĐT trên list đơn Facebook (pos.pancake.vn/.../order).
 * Không gắn sidebar tạo đơn.
 */
(() => {
  const BADGE_ATTR = 'data-vdt-saved-badge';
  const PHONE_RE = /(?:\+?84|0)(?:3[2-9]|5[2689]|7[06-9]|8[1-9]|9\d)\d{7}/;
  /** @type {Map<string, boolean>} */
  const savedCache = new Map();
  /** @type {Set<string>} */
  const inflight = new Set();
  let scanTimer = 0;
  let extensionDead = false;

  function isPosOrderPage() {
    return (
      /\.pancake\.vn$/i.test(location.hostname) &&
      /\/shop\/[^/]+\/order(?:\/|$|\?)/i.test(`${location.pathname}${location.search}`)
    );
  }

  if (!isPosOrderPage()) return;

  function isAlive() {
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

  /** Chuẩn hóa mobile VN → 0xxxxxxxxx. Khớp order.ts / content.js. */
  function normalizePhone(raw) {
    let digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return null;
    if (digits.startsWith('84') && digits.length >= 11) digits = digits.slice(2);
    const bodyOk = /^(?:3[2-9]|5[2689]|7[06-9]|8[1-9]|9\d)\d{7}$/;
    if (digits.length === 9 && bodyOk.test(digits)) digits = `0${digits}`;
    if (digits.length === 10 && digits.startsWith('0') && bodyOk.test(digits.slice(1))) return digits;
    return null;
  }

  function runtimeSend(message) {
    return new Promise((resolve) => {
      if (!isAlive()) {
        resolve(null);
        return;
      }
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          resolve(response ?? null);
        });
      } catch {
        extensionDead = true;
        resolve(null);
      }
    });
  }

  function isFacebookRow(row) {
    return Boolean(
      row.querySelector(
        'img[src*="platforms/facebook" i], img[src*="facebook.png" i], img[src*="/facebook" i]',
      ),
    );
  }

  /** @returns {{ phone: string, mount: HTMLElement } | null} */
  function phoneMountFromRow(row) {
    for (const cell of row.querySelectorAll('.ant-table-cell')) {
      if (!(cell instanceof HTMLElement)) continue;
      const titlePhone = normalizePhone(cell.getAttribute('title') || '');
      const link = cell.querySelector('a');
      const linkPhone = link ? normalizePhone(link.textContent || '') : null;
      const phone = titlePhone || linkPhone;
      if (!phone) continue;
      // Tránh cột khác vô tình có SĐT trong title dài.
      const text = String(cell.textContent || '');
      if (!PHONE_RE.test(text) && !titlePhone) continue;
      const align = cell.querySelector('.align-center') || cell;
      if (!(align instanceof HTMLElement)) continue;
      return { phone, mount: align };
    }
    return null;
  }

  function paintBadge(mount, phone, saved) {
    let badge = mount.querySelector(`[${BADGE_ATTR}]`);
    if (!(badge instanceof HTMLElement)) {
      badge = document.createElement('span');
      badge.setAttribute(BADGE_ATTR, '1');
      badge.className = 'vdt-saved-badge';
      const phoneSpan =
        mount.querySelector('a')?.closest('span') ||
        mount.querySelector('a') ||
        mount.firstElementChild;
      if (phoneSpan?.nextSibling) {
        mount.insertBefore(badge, phoneSpan.nextSibling);
      } else if (phoneSpan) {
        phoneSpan.after(badge);
      } else {
        mount.appendChild(badge);
      }
    }
    badge.dataset.phone = phone;
    badge.dataset.saved = saved ? '1' : '0';
    badge.textContent = saved ? 'đã lưu' : 'chưa lưu';
    badge.title = saved ? 'Đã có đơn trong CMS Vòng Dâu Tằm' : 'Chưa có đơn trong CMS — cần tạo/lưu';
    badge.classList.toggle('is-saved', saved);
    badge.classList.toggle('is-unsaved', !saved);
  }

  function clearNonFbBadges(row) {
    for (const badge of row.querySelectorAll(`[${BADGE_ATTR}]`)) {
      badge.remove();
    }
  }

  async function fetchSavedStatus(phones) {
    const unique = [...new Set(phones.filter(Boolean))];
    const missing = unique.filter((phone) => !savedCache.has(phone) && !inflight.has(phone));
    if (!missing.length) return;
    for (const phone of missing) inflight.add(phone);
    try {
      const result = await runtimeSend({ type: 'vdt-phone-saved-status', phones: missing });
      if (!result?.ok || !Array.isArray(result.items)) return;
      for (const item of result.items) {
        if (typeof item?.phone !== 'string') continue;
        savedCache.set(item.phone, Boolean(item.saved));
      }
    } finally {
      for (const phone of missing) inflight.delete(phone);
    }
  }

  async function scanRows() {
    if (!isAlive() || !isPosOrderPage()) return;
    const rows = document.querySelectorAll('.ant-table-row');
    /** @type {Array<{ phone: string, mount: HTMLElement }>} */
    const targets = [];
    for (const row of rows) {
      if (!(row instanceof HTMLElement)) continue;
      if (!isFacebookRow(row)) {
        clearNonFbBadges(row);
        continue;
      }
      const found = phoneMountFromRow(row);
      if (!found) continue;
      targets.push(found);
      if (savedCache.has(found.phone)) {
        paintBadge(found.mount, found.phone, savedCache.get(found.phone) === true);
      }
    }
    const need = targets.map((t) => t.phone).filter((phone) => !savedCache.has(phone));
    if (need.length) {
      await fetchSavedStatus(need);
      for (const target of targets) {
        if (!savedCache.has(target.phone)) continue;
        paintBadge(target.mount, target.phone, savedCache.get(target.phone) === true);
      }
    }
  }

  function scheduleScan(delayMs = 280) {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(() => {
      void scanRows();
    }, delayMs);
  }

  const observer = new MutationObserver(() => scheduleScan(320));
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener(
    'scroll',
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.ant-table-body, .ant-table, .ant-spin-container')) scheduleScan(400);
    },
    true,
  );
  scheduleScan(500);
})();
