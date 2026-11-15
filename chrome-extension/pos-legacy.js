/**
 * Gắn ô «Địa chỉ cũ» ngay dưới số điện thoại trong form POS.
 * Cần thiết khi iframe đang mở bản production chưa có HTML mới.
 */
(function () {
  if (!/\/admin\/orders\/pos\/?$/.test(location.pathname)) return;

  const STYLE_ID = 'vdt-pos-legacy-style';
  const ROOT_ATTR = 'data-pos-legacy';

  const LABEL = 'Tìm nhanh địa chỉ cũ';

  function ensureStyle() {
    let style = document.getElementById(STYLE_ID);
    if (!(style instanceof HTMLStyleElement)) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      document.documentElement.appendChild(style);
    }
    style.textContent = `
      .pos-legacy { position: relative; margin-top: 0.85rem; }
      .pos-legacy-head { display: grid; gap: 0.35rem; }
      .pos-legacy-title-row { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; }
      .pos-legacy-title-row .od-label { margin: 0; font-weight: 650; }
      .pos-legacy-toggle { flex: none; border: 0; background: transparent; padding: 0; color: #9a3412; font: inherit; font-size: 0.82rem; font-weight: 650; cursor: pointer; text-decoration: underline; text-underline-offset: 0.15em; white-space: nowrap; }
      .pos-legacy-toggle.is-open::after { content: ' ▴'; }
      .pos-legacy-toggle:not(.is-open)::after { content: ' ▾'; }
      .pos-legacy input.field,
      .pos-legacy [data-pos-legacy-input] {
        border-color: #c9a07a !important;
        background: #f8f0e6 !important;
      }
      .pos-legacy input.field:focus,
      .pos-legacy input.field:focus-visible,
      .pos-legacy [data-pos-legacy-input]:focus,
      .pos-legacy [data-pos-legacy-input]:focus-visible {
        border-color: #b8835c !important;
        outline: 2px solid rgba(196, 120, 90, 0.45) !important;
        outline-offset: 2px;
      }
      .pos-legacy-hint { margin: 0.35rem 0 0; color: #6b7280; font-size: 0.78rem; line-height: 1.35; }
      .pos-legacy-list { margin: 0.35rem 0 0; padding: 0.2rem; max-height: 14rem; overflow: auto; list-style: none; border: 1px solid #e5e0d8; border-radius: 0.5rem; background: #fff; }
      .pos-legacy-list[hidden], .pos-legacy-hint[hidden], .pos-legacy-manual[hidden] { display: none !important; }
      .pos-legacy-option { display: flex; flex-direction: column; align-items: flex-start; gap: 0.1rem; width: 100%; border: 0; border-radius: 0.4rem; background: transparent; color: inherit; font: inherit; text-align: left; padding: 0.4rem 0.45rem; cursor: pointer; }
      .pos-legacy-option.is-active, .pos-legacy-option:hover { background: #fff7ed; }
      .pos-legacy-old { color: #6b7280; font-size: 0.75rem; line-height: 1.3; }
      .pos-legacy-new { color: #9a3412; font-size: 0.85rem; font-weight: 700; line-height: 1.3; }
      .pos-legacy-manual { margin-top: 0.55rem; padding: 0.65rem 0.7rem 0.75rem; border: 1px solid #e7d3c0; border-radius: 0.5rem; background: #f6eee4; }
      .pos-legacy-manual-title { margin: 0 0 0.45rem; color: #513328; font-size: 0.78rem; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase; }
      .pos-legacy-manual-grid { display: grid; gap: 0.45rem; }
      .pos-legacy-manual .address-combo { position: relative; min-width: 0; }
      .pos-legacy-manual .address-combo-trigger { display: flex; align-items: center; gap: 0.45rem; width: 100%; text-align: left; cursor: pointer; border-color: #c9a07a !important; background: #fff !important; }
      .pos-legacy-manual .address-combo-trigger:disabled { opacity: 0.65; cursor: not-allowed; }
      .pos-legacy-manual .address-combo-value { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
      .pos-legacy-manual .address-combo-value.is-placeholder { color: #6b7280; font-weight: 500; }
      .pos-legacy-manual .address-combo-caret { display: grid; place-items: center; width: 1rem; height: 1rem; color: #6b7280; }
      .pos-legacy-manual .address-combo-caret svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 1.8; }
      .pos-legacy-manual .address-combo-panel { position: absolute; top: calc(100% + 0.3rem); left: 0; right: 0; z-index: 55; overflow: hidden; border: 1px solid #e5e0d8; border-radius: 0.5rem; background: #fff; box-shadow: 0 12px 28px rgba(44,40,37,0.14); }
      .pos-legacy-manual .address-combo-query { width: 100%; border: 0; border-bottom: 1px solid #e5e0d8; border-radius: 0; background: transparent; padding: 0.65rem 0.75rem; font: inherit; outline: none; }
      .pos-legacy-manual .address-combo-head { margin: 0; padding: 0.35rem 0.75rem; background: #f3ebe2; color: #6b7280; font-size: 0.75rem; font-weight: 700; }
      .pos-legacy-manual .address-combo-list { margin: 0; padding: 0.25rem; max-height: 14rem; overflow: auto; list-style: none; }
      .pos-legacy-manual .address-combo-option { display: block; width: 100%; border: 0; border-radius: 0.35rem; background: transparent; color: inherit; font: inherit; text-align: left; padding: 0.5rem 0.6rem; cursor: pointer; }
      .pos-legacy-manual .address-combo-option:hover, .pos-legacy-manual .address-combo-option[aria-selected="true"] { background: #fff7ed; }
      .pos-legacy-manual .address-combo-empty { padding: 0.65rem; color: #6b7280; font-size: 0.85rem; }
    `;
  }

  function syncLabel(root) {
    if (!(root instanceof HTMLElement)) return;
    const label =
      root.querySelector('.pos-legacy-title-row .od-label') ||
      root.querySelector('label[for="pos-legacy-input"]') ||
      root.querySelector('label[for="vdt-pos-legacy-input"]');
    if (label) label.textContent = LABEL;
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
      <div class="pos-legacy-head">
        <div class="pos-legacy-title-row">
          <label class="od-label" for="vdt-pos-legacy-input">${LABEL}</label>
          <button type="button" class="pos-legacy-toggle" data-pos-legacy-toggle aria-expanded="false">Chọn tay 3 cấp</button>
        </div>
        <input id="vdt-pos-legacy-input" class="field" type="search" placeholder="Tráng Việt, Mê Linh hoặc dán cả câu" autocomplete="off" spellcheck="false" data-pos-legacy-input />
      </div>
      <p class="pos-legacy-hint od-note" data-pos-legacy-hint hidden></p>
      <ul class="pos-legacy-list" data-pos-legacy-list role="listbox" hidden></ul>
      <div class="pos-legacy-manual" data-pos-legacy-manual hidden>
        <p class="pos-legacy-manual-title">Chọn tay địa chỉ cũ</p>
        <div class="pos-legacy-manual-grid">
          <div class="block min-w-0">
            <span class="od-label">Tỉnh / TP cũ</span>
            <div class="address-combo" data-pos-legacy-combo="province">
              <button class="address-combo-trigger field" type="button" data-combo-trigger aria-haspopup="listbox" aria-expanded="false">
                <span class="address-combo-value is-placeholder" data-combo-value>Chọn tỉnh/TP cũ</span>
                <span class="address-combo-caret" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"></path></svg></span>
              </button>
              <div class="address-combo-panel" data-combo-panel hidden>
                <input class="address-combo-query" type="search" placeholder="Tìm tỉnh/TP..." autocomplete="off" data-combo-query />
                <p class="address-combo-head">Tỉnh / TP (cũ)</p>
                <ul class="address-combo-list" data-combo-list role="listbox"></ul>
              </div>
            </div>
          </div>
          <div class="block min-w-0">
            <span class="od-label">Quận / Huyện cũ</span>
            <div class="address-combo" data-pos-legacy-combo="district">
              <button class="address-combo-trigger field" type="button" data-combo-trigger aria-haspopup="listbox" aria-expanded="false" disabled>
                <span class="address-combo-value is-placeholder" data-combo-value>Chọn tỉnh trước</span>
                <span class="address-combo-caret" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"></path></svg></span>
              </button>
              <div class="address-combo-panel" data-combo-panel hidden>
                <input class="address-combo-query" type="search" placeholder="Tìm quận/huyện..." autocomplete="off" data-combo-query />
                <p class="address-combo-head">Quận / Huyện (cũ)</p>
                <ul class="address-combo-list" data-combo-list role="listbox"></ul>
              </div>
            </div>
          </div>
          <div class="block min-w-0">
            <span class="od-label">Phường / Xã cũ</span>
            <div class="address-combo" data-pos-legacy-combo="ward">
              <button class="address-combo-trigger field" type="button" data-combo-trigger aria-haspopup="listbox" aria-expanded="false" disabled>
                <span class="address-combo-value is-placeholder" data-combo-value>Chọn huyện trước</span>
                <span class="address-combo-caret" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"></path></svg></span>
              </button>
              <div class="address-combo-panel" data-combo-panel hidden>
                <input class="address-combo-query" type="search" placeholder="Tìm phường/xã..." autocomplete="off" data-combo-query />
                <p class="address-combo-head">Phường / Xã (cũ)</p>
                <ul class="address-combo-list" data-combo-list role="listbox"></ul>
              </div>
            </div>
          </div>
        </div>
      </div>
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

    const toggle = root.querySelector('[data-pos-legacy-toggle]');
    const manual = root.querySelector('[data-pos-legacy-manual]');
    const provinceCombo = root.querySelector('[data-pos-legacy-combo="province"]');
    const districtCombo = root.querySelector('[data-pos-legacy-combo="district"]');
    const wardCombo = root.querySelector('[data-pos-legacy-combo="ward"]');
    if (
      !(toggle instanceof HTMLButtonElement) ||
      !(manual instanceof HTMLElement) ||
      !(provinceCombo instanceof HTMLElement) ||
      !(districtCombo instanceof HTMLElement) ||
      !(wardCombo instanceof HTMLElement)
    ) {
      return;
    }

    const combos = { province: provinceCombo, district: districtCombo, ward: wardCombo };
    const selection = { province: '', district: '', ward: '' };
    let selectTree = null;

    function fold(value) {
      return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'd')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
    }

    function comboParts(combo) {
      return {
        trigger: combo.querySelector('[data-combo-trigger]'),
        value: combo.querySelector('[data-combo-value]'),
        panel: combo.querySelector('[data-combo-panel]'),
        query: combo.querySelector('[data-combo-query]'),
        list: combo.querySelector('[data-combo-list]'),
      };
    }

    function setTriggerLabel(combo, label, empty) {
      const { value, trigger } = comboParts(combo);
      if (value instanceof HTMLElement) {
        value.textContent = label;
        value.classList.toggle('is-placeholder', empty);
      }
      if (trigger instanceof HTMLButtonElement) trigger.classList.toggle('is-empty', empty);
    }

    function closeCombo(combo) {
      const { trigger, panel, query } = comboParts(combo);
      if (panel instanceof HTMLElement) panel.hidden = true;
      if (trigger instanceof HTMLButtonElement) trigger.setAttribute('aria-expanded', 'false');
      combo.classList.remove('is-open');
      if (query instanceof HTMLInputElement) query.value = '';
    }

    function closeAllCombos(except) {
      for (const combo of Object.values(combos)) {
        if (combo !== except) closeCombo(combo);
      }
    }

    function optionsFor(kind) {
      if (!selectTree) return [];
      if (kind === 'province') return selectTree.provinces || [];
      if (kind === 'district') return selection.province ? selectTree.districts?.[selection.province] || [] : [];
      if (!selection.province || !selection.district) return [];
      return selectTree.wards?.[`${selection.province}\t${selection.district}`] || [];
    }

    function renderComboList(combo, kind, needleRaw) {
      const { list } = comboParts(combo);
      if (!(list instanceof HTMLElement)) return;
      const tokens = fold(needleRaw).split(' ').filter(Boolean);
      const selected = selection[kind];
      const fragment = document.createDocumentFragment();
      let shown = 0;
      for (const name of optionsFor(kind)) {
        if (tokens.length && !tokens.every((token) => fold(name).includes(token))) continue;
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'address-combo-option';
        item.setAttribute('role', 'option');
        item.dataset.value = name;
        item.setAttribute('aria-selected', String(name === selected));
        item.textContent = name;
        item.addEventListener('mousedown', (event) => {
          event.preventDefault();
          pickManual(kind, name);
        });
        fragment.append(item);
        shown += 1;
        if (shown >= 80) break;
      }
      if (!shown) {
        const empty = document.createElement('p');
        empty.className = 'address-combo-empty';
        empty.textContent = 'Không có kết quả khớp.';
        list.replaceChildren(empty);
        return;
      }
      list.replaceChildren(fragment);
    }

    function openCombo(combo, kind) {
      const { trigger, panel, query } = comboParts(combo);
      if (trigger instanceof HTMLButtonElement && trigger.disabled) return;
      closeAllCombos(combo);
      closeList();
      if (panel instanceof HTMLElement) panel.hidden = false;
      if (trigger instanceof HTMLButtonElement) trigger.setAttribute('aria-expanded', 'true');
      combo.classList.add('is-open');
      renderComboList(combo, kind, '');
      requestAnimationFrame(() => {
        if (query instanceof HTMLInputElement) {
          query.value = '';
          query.focus();
          query.select();
        }
      });
    }

    function syncDependentTriggers() {
      const districtTrigger = comboParts(combos.district).trigger;
      const wardTrigger = comboParts(combos.ward).trigger;
      if (districtTrigger instanceof HTMLButtonElement) districtTrigger.disabled = !selection.province;
      if (wardTrigger instanceof HTMLButtonElement) wardTrigger.disabled = !selection.district;
      if (!selection.province) {
        setTriggerLabel(combos.district, 'Chọn tỉnh trước', true);
        setTriggerLabel(combos.ward, 'Chọn huyện trước', true);
      } else if (!selection.district) {
        setTriggerLabel(combos.district, 'Chọn quận/huyện', true);
        setTriggerLabel(combos.ward, 'Chọn huyện trước', true);
      } else if (!selection.ward) {
        setTriggerLabel(combos.ward, 'Chọn phường/xã', true);
      }
    }

    function resetManualSelection() {
      selection.province = '';
      selection.district = '';
      selection.ward = '';
      setTriggerLabel(combos.province, 'Chọn tỉnh/TP cũ', true);
      syncDependentTriggers();
    }

    function applyManualSelection() {
      if (!selection.province || !selection.district || !selection.ward) return;
      try {
        chrome.runtime.sendMessage({ type: 'vdt-legacy-resolve', selection: { ...selection } }, (data) => {
          if (chrome.runtime.lastError || !data?.ok || !data.item) {
            setHint('Không khớp được địa chỉ 2 cấp cho lựa chọn này.');
            return;
          }
          onPick(data.item);
          resetManualSelection();
        });
      } catch {
        setHint('Không khớp được địa chỉ 2 cấp cho lựa chọn này.');
      }
    }

    function pickManual(kind, name) {
      selection[kind] = name;
      setTriggerLabel(combos[kind], name, false);
      closeCombo(combos[kind]);
      if (kind === 'province') {
        selection.district = '';
        selection.ward = '';
        syncDependentTriggers();
        requestAnimationFrame(() => openCombo(combos.district, 'district'));
        return;
      }
      if (kind === 'district') {
        selection.ward = '';
        syncDependentTriggers();
        requestAnimationFrame(() => openCombo(combos.ward, 'ward'));
        return;
      }
      applyManualSelection();
    }

    function bindManualCombo(combo, kind) {
      const { trigger, query, panel } = comboParts(combo);
      trigger?.addEventListener('click', () => {
        if (!(panel instanceof HTMLElement)) return;
        if (panel.hidden) openCombo(combo, kind);
        else closeCombo(combo);
      });
      query?.addEventListener('input', () => {
        if (query instanceof HTMLInputElement) renderComboList(combo, kind, query.value);
      });
      if (query instanceof HTMLInputElement) {
        query.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            closeCombo(combo);
            if (trigger instanceof HTMLButtonElement) trigger.focus();
          }
        });
      }
    }

    function loadTree(done) {
      if (selectTree) {
        done(selectTree);
        return;
      }
      try {
        chrome.runtime.sendMessage({ type: 'vdt-legacy-tree' }, (data) => {
          if (chrome.runtime.lastError || !data?.ok || !data.tree) {
            setHint('Không tải được danh sách địa chỉ. Tải lại extension.');
            return;
          }
          selectTree = data.tree;
          done(selectTree);
        });
      } catch {
        setHint('Không tải được danh sách địa chỉ. Tải lại extension.');
      }
    }

    bindManualCombo(combos.province, 'province');
    bindManualCombo(combos.district, 'district');
    bindManualCombo(combos.ward, 'ward');
    syncDependentTriggers();

    toggle.addEventListener('click', () => {
      const open = manual.hasAttribute('hidden');
      manual.hidden = !open;
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.classList.toggle('is-open', open);
      if (!open) {
        closeAllCombos();
        return;
      }
      loadTree(() => {
        if (!selection.province) syncDependentTriggers();
      });
    });

    document.addEventListener('mousedown', (event) => {
      if (!(event.target instanceof Node) || !manual.contains(event.target)) {
        closeAllCombos();
        return;
      }
      for (const combo of Object.values(combos)) {
        if (!combo.contains(event.target)) closeCombo(combo);
      }
    });
  }

  function boot() {
    ensureStyle();
    const existing = document.querySelector(`[${ROOT_ATTR}]`);
    // Trang POS local/mới đã có ô sẵn — không gắn trùng, vẫn đồng bộ nhãn/màu.
    if (existing instanceof HTMLElement) {
      syncLabel(existing);
      if (existing.dataset.vdtInjected === '1') bind(existing);
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
