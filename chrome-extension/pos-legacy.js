/**
 * Gắn ô «Địa chỉ cũ» ngay dưới số điện thoại trong form POS.
 * Cần thiết khi iframe đang mở bản production chưa có HTML mới.
 */
(function () {
  if (!/\/admin\/orders\/pos\/?$/.test(location.pathname)) return;

  const STYLE_ID = 'vdt-pos-legacy-style';
  const ROOT_ATTR = 'data-pos-legacy';

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .pos-legacy { position: relative; margin-top: 0.85rem; }
      .pos-legacy-hint { margin: 0.35rem 0 0; color: #6b7280; font-size: 0.78rem; line-height: 1.35; }
      .pos-legacy-list { margin: 0.35rem 0 0; padding: 0.2rem; max-height: 14rem; overflow: auto; list-style: none; border: 1px solid #e5e0d8; border-radius: 0.5rem; background: #fff; }
      .pos-legacy-list[hidden], .pos-legacy-hint[hidden] { display: none !important; }
      .pos-legacy-option { display: flex; flex-direction: column; align-items: flex-start; gap: 0.1rem; width: 100%; border: 0; border-radius: 0.4rem; background: transparent; color: inherit; font: inherit; text-align: left; padding: 0.4rem 0.45rem; cursor: pointer; }
      .pos-legacy-option.is-active, .pos-legacy-option:hover { background: #fff7ed; }
      .pos-legacy-old { color: #6b7280; font-size: 0.75rem; line-height: 1.3; }
      .pos-legacy-new { color: #9a3412; font-size: 0.85rem; font-weight: 700; line-height: 1.3; }
    `;
    document.documentElement.appendChild(style);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function mountRoot() {
    const phone = document.querySelector('[data-customer-phone]');
    if (!(phone instanceof HTMLInputElement)) return null;
    const anchor = phone.closest('.form-pair') || phone.closest('label')?.parentElement || phone.parentElement;
    if (!(anchor instanceof HTMLElement)) return null;

    ensureStyle();
    const root = document.createElement('div');
    root.className = 'pos-legacy';
    root.setAttribute(ROOT_ATTR, '1');
    root.dataset.vdtInjected = '1';
    root.innerHTML = `
      <label class="block" for="vdt-pos-legacy-input">
        <span class="od-label" style="display:block;margin-bottom:0.25rem;font-weight:650">Địa chỉ cũ</span>
        <input id="vdt-pos-legacy-input" class="field" type="search" placeholder="Tráng Việt, Mê Linh hoặc dán cả câu" autocomplete="off" spellcheck="false" data-pos-legacy-input />
      </label>
      <p class="pos-legacy-hint od-note" data-pos-legacy-hint hidden></p>
      <ul class="pos-legacy-list" data-pos-legacy-list role="listbox" hidden></ul>
    `;
    anchor.insertAdjacentElement('afterend', root);
    return root;
  }

  function applyHit(hit) {
    const form = document.querySelector('form.staff-order-pos, form.staff-order');
    const addressRoot = form?.querySelector('[data-address]');
    if (!(addressRoot instanceof HTMLElement)) return;
    const line = typeof hit.line === 'string' ? hit.line : '';
    addressRoot.dispatchEvent(
      new CustomEvent('staff-fill-address', {
        detail: {
          provinceCode: hit.provinceCode,
          wardCode: hit.wardCode,
          line,
          keepLine: line.length === 0,
        },
      }),
    );
    // Bản POS cũ chưa lắng nghe staff-fill-address: điền chuỗi ghép.
    if (typeof hit.wardName === 'string' && typeof hit.provinceName === 'string') {
      const composed = [line, hit.wardName, hit.provinceName].filter(Boolean).join(', ');
      if (composed) {
        addressRoot.dispatchEvent(new CustomEvent('pos-set-address', { detail: { address: composed, chat: false } }));
      }
    }
  }

  function bind(root) {
    if (!(root instanceof HTMLElement) || root.dataset.bound === '1') return;
    root.dataset.bound = '1';

    const input = root.querySelector('[data-pos-legacy-input]');
    const hint = root.querySelector('[data-pos-legacy-hint]');
    const list = root.querySelector('[data-pos-legacy-list]');
    if (!(input instanceof HTMLInputElement) || !(hint instanceof HTMLElement) || !(list instanceof HTMLElement)) return;

    let timer = 0;
    let waitHint = 0;
    let requestSeq = 0;
    let hits = [];
    let active = -1;
    let ready = false;

    function setHint(text) {
      hint.hidden = !text;
      hint.textContent = text || '';
    }

    function closeList() {
      list.hidden = true;
      list.innerHTML = '';
      active = -1;
      hits = [];
    }

    function paint() {
      list.innerHTML = hits
        .map((hit, index) => {
          const oldLine = hit.oldText
            ? `<span class="pos-legacy-old">${escapeHtml(hit.oldText)}</span>`
            : '<span class="pos-legacy-old">Địa chỉ mới</span>';
          return `<li><button type="button" class="pos-legacy-option${index === active ? ' is-active' : ''}" data-pos-legacy-index="${index}" role="option">${oldLine}<span class="pos-legacy-new">${escapeHtml(hit.newText)}</span></button></li>`;
        })
        .join('');
      list.hidden = hits.length === 0;
      const current = list.querySelector('.is-active');
      if (current instanceof HTMLElement) current.scrollIntoView({ block: 'nearest' });
    }

    function showResults(requestId, data) {
      window.clearTimeout(waitHint);
      if (String(requestSeq) !== String(requestId)) return;
      hits = data?.ok && Array.isArray(data.items) ? data.items : [];
      active = hits.length === 1 ? 0 : -1;
      paint();
      if (!data?.ok) setHint('Không tải được danh sách địa chỉ. Tải lại extension.');
      else if (hits.length === 0) setHint('Không thấy. Gõ thêm huyện hoặc tỉnh.');
      else if (data.more) setHint('Còn nhiều dòng. Thêm huyện hoặc tỉnh để lọc.');
      else setHint(hits.length === 1 ? 'Enter để điền dòng này.' : 'Chọn đúng huyện, tỉnh của khách.');
    }

    function warm() {
      try {
        chrome.runtime.sendMessage({ type: 'vdt-legacy-warmup' }, (data) => {
          if (!chrome.runtime.lastError && data?.ok) ready = true;
        });
      } catch {
        /* ignore */
      }
    }

    function runSearch(query) {
      requestSeq += 1;
      const requestId = String(requestSeq);
      window.clearTimeout(waitHint);
      waitHint = window.setTimeout(() => {
        if (String(requestSeq) === requestId) setHint(ready ? 'Đang tìm…' : 'Đang chuẩn bị danh sách địa chỉ…');
      }, 220);
      try {
        chrome.runtime.sendMessage({ type: 'vdt-legacy-search', query }, (data) => {
          if (chrome.runtime.lastError) {
            showResults(requestId, { ok: false, items: [] });
            return;
          }
          if (data?.ready) ready = true;
          showResults(requestId, data);
        });
      } catch {
        showResults(requestId, { ok: false, items: [] });
      }
    }

    function onPick(hit) {
      if (!hit) return;
      applyHit(hit);
      input.value = '';
      closeList();
      setHint(`Đã điền ${hit.newText}`);
    }

    warm();
    input.addEventListener('focus', warm);
    input.addEventListener('input', () => {
      window.clearTimeout(timer);
      const query = input.value.trim();
      if (query.length < 2) {
        closeList();
        setHint('');
        return;
      }
      if (!ready) setHint('Đang chuẩn bị danh sách địa chỉ…');
      timer = window.setTimeout(() => runSearch(query), 100);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeList();
        setHint('');
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (!hits.length) return;
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        active = active < 0 ? (step > 0 ? 0 : hits.length - 1) : (active + step + hits.length) % hits.length;
        paint();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        if (active >= 0) onPick(hits[active]);
        else if (hits.length === 1) onPick(hits[0]);
      }
    });
    list.addEventListener('mousedown', (event) => {
      const button = event.target instanceof Element ? event.target.closest('[data-pos-legacy-index]') : null;
      if (!(button instanceof HTMLButtonElement)) return;
      event.preventDefault();
      onPick(hits[Number(button.dataset.posLegacyIndex)]);
    });
    document.addEventListener('mousedown', (event) => {
      if (!(event.target instanceof Node) || root.contains(event.target)) return;
      closeList();
    });
  }

  function boot() {
    const existing = document.querySelector(`[${ROOT_ATTR}]`);
    // Trang POS local/mới đã có ô sẵn — không gắn trùng.
    if (existing) {
      if (existing instanceof HTMLElement && existing.dataset.vdtInjected === '1') bind(existing);
      return;
    }
    const root = mountRoot();
    if (root) bind(root);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();

  const observer = new MutationObserver(() => {
    if (!document.querySelector(`[${ROOT_ATTR}]`) && document.querySelector('[data-customer-phone]')) boot();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
