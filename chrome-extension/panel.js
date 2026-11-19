(() => {
  const bootStatus = document.querySelector('[data-boot-status]');
  const authBox = document.querySelector('[data-auth]');
  const authText = document.querySelector('[data-auth-text]');
  const form = document.querySelector('[data-form]');
  const formError = document.querySelector('[data-form-error]');
  const savedEl = document.querySelector('[data-saved]');
  const submitBtn = document.querySelector('[data-submit]');
  const sendConfirmBtn = document.querySelector('[data-send-confirm]');
  const sendConfirmCreateBtn = document.querySelector('[data-send-confirm-create]');
  const createSubmitLabel = 'Tạo đơn hàng';
  const editSubmitLabel = 'Lưu đơn';
  const submitLabel = createSubmitLabel;
  let submitting = false;
  let sendingConfirm = false;
  /** @type {{ resolve: (value: { ok: boolean, error?: string }) => void } | null} */
  let confirmWaiter = null;
  /** @type {number | null} */
  let editingOrderId = null;
  let editingOrderCode = '';
  const editBanner = document.querySelector('[data-edit-banner]');
  const editText = document.querySelector('[data-edit-text]');
  const editCancel = document.querySelector('[data-edit-cancel]');

  const nameInput = document.querySelector('[data-customer-name]');
  const phoneInput = document.querySelector('[data-customer-phone]');
  const lookupInput = document.querySelector('[data-lookup-phone]');
  const lookupRun = document.querySelector('[data-lookup-run]');
  const lookupResult = document.querySelector('[data-lookup-result]');

  const addressRoot = document.querySelector('[data-address]');
  const addressMap = document.querySelector('[data-address-map]');
  const addressMapTitle = document.querySelector('[data-address-map-title]');
  const addressMapOld = document.querySelector('[data-address-map-old]');
  const addressMapNew = document.querySelector('[data-address-map-new]');
  const addressMapClose = document.querySelector('[data-address-map-close]');
  const provinceCombo = document.querySelector('[data-address-combo="province"]');
  const wardCombo = document.querySelector('[data-address-combo="ward"]');
  const lineInput = document.querySelector('[data-line]');
  const addressValue = document.querySelector('[data-address-value]');
  const provinceValue = document.querySelector('[data-province-value]');
  const wardValue = document.querySelector('[data-ward-value]');
  const addressSelection = { provinceCode: '', wardCode: '' };

  const legacyRoot = document.querySelector('[data-legacy]');
  const legacyInput = document.querySelector('[data-legacy-input]');
  const legacyHint = document.querySelector('[data-legacy-hint]');
  const legacyList = document.querySelector('[data-legacy-list]');
  const legacyToggle = document.querySelector('[data-legacy-toggle]');
  const legacyManual = document.querySelector('[data-legacy-manual]');

  const pickQuery = document.querySelector('[data-pick-query]');
  const pickCats = document.querySelector('[data-pick-cats]');
  const pickList = document.querySelector('[data-pick-list]');
  const pickEmpty = document.querySelector('[data-pick-empty]');
  const cartEl = document.querySelector('[data-cart]');
  const cartEmpty = document.querySelector('[data-cart-empty]');
  const discountCode = document.querySelector('[data-discount-code]');
  const discountExtra = document.querySelector('[data-discount-extra]');
  const orderTotal = document.querySelector('[data-order-total]');
  const paySummary = document.querySelector('[data-pay-summary]');
  const orderGrandTotal = document.querySelector('[data-order-grand-total]');

  const payStatesEl = document.querySelector('[data-pay-states]');
  const sourcesEl = document.querySelector('[data-sources]');
  const depositBox = document.querySelector('[data-deposit-box]');
  const depositAmount = document.querySelector('[data-deposit-amount]');
  const priorityEl = document.querySelector('[data-priority]');
  const compensationEl = document.querySelector('[data-compensation]');
  const shipLaterEl = document.querySelector('[data-ship-later]');
  const shipDateBox = document.querySelector('[data-ship-date]');
  const shipOnEl = document.querySelector('[data-ship-on]');
  const shipPresetsEl = document.querySelector('[data-ship-presets]');
  const shipFeeEl = document.querySelector('[data-ship-fee]');
  const freeShipEl = document.querySelector('[data-free-ship]');
  const shipNoteEl = document.querySelector('[data-ship-note]');

  /** @type {null | object} */
  let bootstrap = null;
  /** @type {Array<[string, string, [string, string][]]>} */
  let addressRows = [];
  /** @type {null | object} */
  let legacyTree = null;
  let readyNotified = false;
  let legacyTimer = 0;
  let legacyActive = -1;
  /** @type {object[]} */
  let legacyItems = [];
  const manualSelection = { province: '', district: '', ward: '' };

  /** @type {object[]} */
  let products = [];
  /** @type {Map<string, object>} */
  let weightScaleMap = new Map();
  let pickCategory = 'hot';
  let pickText = '';
  /** @type {null | object} */
  let pendingProduct = null;
  let pendingWeight = '';
  let pendingQty = 1;
  let pendingNote = '';
  let extraOpen = false;
  /** @type {Array<{key: string, productId: number, name: string, weight: string, quantity: number, note: string, unitPrice: number, categorySlug: string}>} */
  let cart = [];
  let defaultShipFee = '';

  function show(el, on) {
    if (el instanceof HTMLElement) el.hidden = !on;
  }

  function setBoot(text) {
    if (bootStatus instanceof HTMLElement) {
      bootStatus.textContent = text;
      bootStatus.hidden = !text;
    }
  }

  function setFormError(text) {
    const msg = String(text || '').trim();
    if (formError instanceof HTMLElement) {
      formError.hidden = !msg;
      formError.textContent = msg;
    }
    // Có lỗi → ẩn banner thành công cũ để không chồng 2–3 thông báo.
    if (msg && savedEl instanceof HTMLElement) savedEl.hidden = true;
  }

  function isValidOrderPhone(raw) {
    const compact = String(raw || '').replace(/[\s.\-()]/g, '');
    const local = compact.startsWith('+84')
      ? `0${compact.slice(3)}`
      : compact.startsWith('84') && compact.length >= 11
        ? `0${compact.slice(2)}`
        : compact;
    return /^0(?:3[2-9]|5[2689]|7[06-9]|8[1-9]|9\d)\d{7}$/.test(local);
  }

  /** Kiểm tra đủ thông tin bắt buộc; nếu thiếu thì báo lỗi + cuộn tới trường. */
  function requireDraftReady() {
    const draft = collectDraft();
    const issue = validateDraft(draft);
    if (issue) {
      revealInvalid(issue);
      return null;
    }
    clearFieldAttention();
    setFormError('');
    return draft;
  }

  let attentionTimer = 0;

  function clearFieldAttention() {
    window.clearTimeout(attentionTimer);
    for (const node of document.querySelectorAll('.is-field-attention, .is-block-attention')) {
      node.classList.remove('is-field-attention', 'is-block-attention');
    }
  }

  function setStatusMessage(text) {
    const msg = String(text || '').trim();
    setFormError('');
    if (!(savedEl instanceof HTMLElement)) return;
    if (!msg) {
      savedEl.hidden = true;
      savedEl.textContent = '';
      return;
    }
    savedEl.hidden = false;
    savedEl.textContent = msg;
  }

  /** @param {Element | null | undefined} el */
  function resolveAttentionTarget(el) {
    if (!(el instanceof Element)) return null;
    if (el.hasAttribute('data-cart-empty') || el === cartEmpty || el === cartEl || el.hasAttribute('data-cart')) {
      return (
        document.querySelector('[data-section="cart"]') ||
        document.querySelector('[data-section="products"]') ||
        el
      );
    }
    if (el.hasAttribute('data-sources') || el === sourcesEl) {
      return el.closest('.meta-block') || el;
    }
    if (el.hasAttribute('data-pay-states') || el === payStatesEl) {
      return el.closest('.meta-block') || el;
    }
    if (el.closest('.presets')) return el.closest('.presets');
    if (el.closest('.flag')) return el.closest('.flag');
    if (el.matches('input, select, textarea, button, .field')) return el;
    return el;
  }

  /** Cuộn tới trường lỗi + pulse; nội dung lỗi chỉ hiện ở [data-form-error]. */
  function revealInvalid(issue) {
    clearFieldAttention();
    const msg = issue?.msg || 'Thiếu thông tin.';
    setFormError(msg);

    const target = resolveAttentionTarget(issue?.el);
    if (!(target instanceof HTMLElement)) {
      if (formError instanceof HTMLElement) {
        formError.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      return;
    }

    const block =
      target.closest('.meta-block, .card, .block, .ship-row, .pick-card, .flag-list, .discount') || target;
    if (block instanceof HTMLElement) block.classList.add('is-block-attention');
    target.classList.add('is-field-attention');

    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);

    if (typeof target.focus === 'function' && target.matches('input, select, textarea, button')) {
      try {
        target.focus({ preventScroll: true });
      } catch {
        target.focus();
      }
    }

    attentionTimer = window.setTimeout(clearFieldAttention, 2600);
  }

  function isEditing() {
    return Number.isInteger(editingOrderId) && editingOrderId > 0;
  }

  function setButtonLabel(button, text) {
    if (!(button instanceof HTMLButtonElement)) return;
    const span = button.querySelector('span');
    if (span) span.textContent = text;
    else button.textContent = text;
  }

  function paintEditMode() {
    const editing = isEditing();
    show(editBanner, editing);
    if (editText instanceof HTMLElement) {
      editText.textContent = editing
        ? `Đang sửa ${editingOrderCode || `đơn #${editingOrderId}`}`
        : 'Đang sửa đơn';
    }
    if (submitBtn instanceof HTMLButtonElement && !submitting) {
      setButtonLabel(submitBtn, editing ? editSubmitLabel : submitLabel || createSubmitLabel);
    }
  }

  function clearEditMode({ resetForm = false } = {}) {
    editingOrderId = null;
    editingOrderCode = '';
    paintEditMode();
    if (resetForm) resetAfterCreate();
  }

  function setSubmitBusy(busy) {
    if (!(submitBtn instanceof HTMLButtonElement)) return;
    submitBtn.disabled = busy;
    if (busy) {
      setButtonLabel(submitBtn, isEditing() ? 'Đang lưu…' : 'Đang tạo…');
      return;
    }
    setButtonLabel(submitBtn, isEditing() ? editSubmitLabel : submitLabel || createSubmitLabel);
  }

  async function adminOrigin() {
    const info = await send('vdt-get-pos-url');
    try {
      return info?.posUrl ? new URL(info.posUrl).origin : '';
    } catch {
      return '';
    }
  }

  async function showSaved(result, { updated = false } = {}) {
    if (!(savedEl instanceof HTMLElement)) return;
    const origin = await adminOrigin();
    const code = result.code || `#${result.id}`;
    const total = result.total ? ` · ${result.total}` : '';
    const path = typeof result.url === 'string' ? result.url : `/admin/orders/${result.id}`;
    const href = path.startsWith('http') ? path : `${origin}${path.startsWith('/') ? '' : '/'}${path}`;
    savedEl.hidden = false;
    savedEl.innerHTML = '';
    savedEl.append(updated ? 'Đã lưu đơn ' : 'Đã tạo đơn ');
    const link = document.createElement('a');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = code;
    savedEl.append(link, updated ? `${total}.` : `${total}. Tiếp tục đơn mới bên dưới.`);
    savedEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function setMetaFlags(flags) {
    if (!flags || typeof flags !== 'object') return;
    const pay = String(flags.payState || 'cod');
    const source = String(flags.source || '');
    for (const input of document.querySelectorAll('input[name="payState"]')) {
      if (input instanceof HTMLInputElement) input.checked = input.value === pay;
    }
    for (const input of document.querySelectorAll('input[name="source"]')) {
      if (input instanceof HTMLInputElement) input.checked = input.value === source;
    }
    if (priorityEl instanceof HTMLInputElement) priorityEl.checked = Boolean(flags.priority);
    if (compensationEl instanceof HTMLInputElement) compensationEl.checked = Boolean(flags.compensation);
    if (shipLaterEl instanceof HTMLInputElement) shipLaterEl.checked = Boolean(flags.shipLater);
    if (shipOnEl instanceof HTMLInputElement) shipOnEl.value = String(flags.shipOn || '');
    if (freeShipEl instanceof HTMLInputElement) freeShipEl.checked = Boolean(flags.freeShip);
    if (shipFeeEl instanceof HTMLInputElement) {
      shipFeeEl.value = flags.freeShip ? '' : groupDigits(String(flags.shippingFee || ''), 8);
      shipFeeEl.disabled = Boolean(flags.freeShip);
    }
    if (depositAmount instanceof HTMLInputElement) {
      depositAmount.value = groupDigits(String(flags.depositAmount || ''), 8);
    }
    show(depositBox, pay === 'deposit');
    show(shipDateBox, Boolean(flags.shipLater));
  }

  function loadOrderIntoForm(order) {
    if (!order || typeof order !== 'object') return;
    if (nameInput instanceof HTMLInputElement) nameInput.value = String(order.customerName || '').slice(0, 80);
    if (phoneInput instanceof HTMLInputElement) phoneInput.value = String(order.phone || '');
    if (lookupInput instanceof HTMLInputElement) lookupInput.value = String(order.phone || '');
    const noteEl = document.querySelector('[data-note]');
    if (noteEl instanceof HTMLInputElement) noteEl.value = String(order.note || '').slice(0, 500);
    applyComposedAddress(String(order.address || ''));
    cart = (Array.isArray(order.lines) ? order.lines : []).map((line, index) => {
      const productId = Number(line.productId);
      const weight = String(line.weight || '');
      const note = String(line.note || '');
      const quantity = Math.max(1, Math.min(20, Number(line.quantity) || 1));
      const unitPrice = Math.max(0, Number(line.unitPrice) || 0);
      const name = String(line.productName || '');
      const categorySlug = String(line.categorySlug || '');
      const catalog = products.find((item) => Number(item.id) === productId);
      return {
        key: `${productId || index}|${weight}|${note}`,
        productId: Number.isInteger(productId) ? productId : 0,
        name,
        weight,
        quantity,
        note,
        unitPrice,
        categorySlug,
        coverUrl: String(catalog?.coverUrl || line.coverUrl || ''),
      };
    });
    closePickPanel();
    renderCart();
    renderPickList();
    if (discountCode instanceof HTMLSelectElement) discountCode.value = String(order.discountCode || '');
    if (discountExtra instanceof HTMLInputElement) discountExtra.value = '';
    if (orderTotal instanceof HTMLInputElement) {
      orderTotal.value = groupDigits(String(order.totalPrice || ''), 9);
    }
    setMetaFlags(order.flags);
    paintPay();
    if (savedEl instanceof HTMLElement) savedEl.hidden = true;
    setFormError('');
    form?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function fetchOrderForForm(orderId, { forEdit = false } = {}) {
    const id = Number(orderId);
    if (!Number.isInteger(id) || id < 1) return null;
    setFormError('');
    setBoot(forEdit ? 'Đang tải đơn để sửa…' : 'Đang nhân bản đơn…');
    try {
      await ensureAddressRows().catch(() => null);
      if (!bootstrap) await loadBootstrap();
      const result = await send('vdt-pos-order-get', { orderId: id });
      setBoot('');
      if (result?.error === 'auth') {
        show(form, false);
        show(authBox, true);
        setFormError(forEdit ? 'Cần đăng nhập admin để sửa đơn.' : 'Cần đăng nhập admin để nhân bản đơn.');
        return null;
      }
      if (!result?.ok || !result.order) {
        setFormError(result?.error || 'Không tải được đơn.');
        return null;
      }
      if (forEdit && !result.order.editable) {
        setFormError('Đơn đã kết thúc, không sửa được.');
        return null;
      }
      show(authBox, false);
      show(form, true);
      return result.order;
    } catch {
      setBoot('');
      setFormError('Không tải được đơn. Thử lại.');
      return null;
    }
  }

  async function beginEditOrder(orderId) {
    const order = await fetchOrderForForm(orderId, { forEdit: true });
    if (!order) return;
    editingOrderId = Number(order.id) || Number(orderId);
    editingOrderCode = String(order.code || '');
    loadOrderIntoForm(order);
    paintEditMode();
  }

  async function beginDuplicateOrder(orderId) {
    const order = await fetchOrderForForm(orderId, { forEdit: false });
    if (!order) return;
    // Nhân bản = tạo đơn mới: không gắn editingOrderId.
    editingOrderId = null;
    editingOrderCode = '';
    paintEditMode();
    loadOrderIntoForm(order);
    // Tổng thu để trống để tính lại theo giỏ (đơn mới).
    if (orderTotal instanceof HTMLInputElement) orderTotal.value = '';
    if (discountExtra instanceof HTMLInputElement) discountExtra.value = '';
    paintPay();
    setFormError('');
    if (savedEl instanceof HTMLElement) {
      savedEl.hidden = false;
      savedEl.textContent = `Đã nhân bản từ ${order.code || 'đơn gốc'} — chỉnh rồi bấm Tạo đơn hàng.`;
    }
  }

  function resetAfterCreate() {
    cart = [];
    closePickPanel();
    renderCart();
    renderPickList();
    if (discountCode instanceof HTMLSelectElement) discountCode.value = '';
    if (discountExtra instanceof HTMLInputElement) discountExtra.value = '';
    if (orderTotal instanceof HTMLInputElement) orderTotal.value = '';
    if (depositAmount instanceof HTMLInputElement) depositAmount.value = '';
    if (lineInput instanceof HTMLInputElement) lineInput.value = '';
    fillProvinces();
    writeAddress();
    clearAddressMap();
    const noteEl = document.querySelector('[data-note]');
    if (noteEl instanceof HTMLInputElement) noteEl.value = '';
    setLookupNote('');
    setLegacyHint('');
    if (legacyInput instanceof HTMLInputElement) legacyInput.value = '';
    closeLegacyList();
    // Giữ tên / SĐT / nguồn / thanh toán để tạo đơn tiếp.
    paintPay();
  }

  function mapCreateError(result) {
    if (result?.errors?.customerName) return { el: nameInput, msg: result.errors.customerName };
    if (result?.errors?.phone) return { el: phoneInput, msg: result.errors.phone };
    if (result?.errors?.address) return { el: lineInput, msg: result.errors.address };
    if (result?.field === 'lines') return { el: cartEmpty, msg: result.error || 'Thêm ít nhất một sản phẩm.' };
    if (result?.field === 'flags') {
      if (/nguồn/i.test(result.error || '')) return { el: sourcesEl, msg: result.error };
      if (/cọc/i.test(result.error || '')) return { el: depositAmount, msg: result.error };
      if (/ngày|gửi sau/i.test(result.error || '')) return { el: shipOnEl, msg: result.error };
      return { el: null, msg: result.error || 'Thông tin thanh toán/giao chưa hợp lệ.' };
    }
    return { el: null, msg: result?.error || 'Không tạo được đơn. Thử lại.' };
  }

  function setLookupNote(text) {
    if (!(lookupResult instanceof HTMLElement)) return;
    lookupResult.hidden = !text;
    lookupResult.textContent = text || '';
  }

  function setLegacyHint(text) {
    if (!(legacyHint instanceof HTMLElement)) return;
    legacyHint.hidden = !text;
    legacyHint.textContent = text || '';
  }

  function clearAddressMap() {
    if (addressMap instanceof HTMLElement) addressMap.hidden = true;
    if (addressMapOld instanceof HTMLElement) addressMapOld.textContent = '';
    if (addressMapNew instanceof HTMLElement) addressMapNew.textContent = '';
  }

  /** Banner xác nhận map 3 cấp → 2 cấp (hoặc chỉ địa chỉ mới nếu không có oldText). */
  function showAddressMap(input) {
    if (!(addressMap instanceof HTMLElement)) return;
    const oldText = typeof input?.oldText === 'string' ? input.oldText.trim() : '';
    const newText = typeof input?.newText === 'string' ? input.newText.trim() : '';
    if (!newText) {
      clearAddressMap();
      return;
    }
    if (addressMapTitle instanceof HTMLElement) {
      addressMapTitle.textContent = oldText ? 'Đã đổi 3 cấp → 2 cấp (theo map 2025)' : 'Đã nhận địa chỉ 2 cấp';
    }
    if (addressMapOld instanceof HTMLElement) {
      addressMapOld.hidden = !oldText;
      addressMapOld.textContent = oldText ? `Cũ: ${oldText}` : '';
    }
    if (addressMapNew instanceof HTMLElement) addressMapNew.textContent = `Mới: ${newText}`;
    const arrow = addressMap.querySelector('.address-map-arrow');
    if (arrow instanceof HTMLElement) arrow.hidden = !oldText;
    addressMap.hidden = false;
  }

  function notifyReady() {
    if (readyNotified) return;
    readyNotified = true;
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ source: 'vdt-pos', type: 'vdt-pos-ready' }, '*');
      }
    } catch {
      /* ignore */
    }
  }

  function send(type, payload = {}) {
    return new Promise((resolve) => {
      const softReload = 'Extension đã reload — F5 trang chat rồi thử lại.';
      try {
        if (!chrome?.runtime?.id) {
          resolve({ ok: false, error: softReload });
          return;
        }
        const body = { type, ...payload };
        const maybePromise = chrome.runtime.sendMessage(body);
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise
            .then((result) => {
              resolve(result && typeof result === 'object' ? result : { ok: false, error: 'empty' });
            })
            .catch((error) => {
              const msg = error instanceof Error ? error.message : String(error || '');
              resolve({
                ok: false,
                error: /invalidated|extension context/i.test(msg) ? softReload : msg || 'extension',
              });
            });
          return;
        }
        chrome.runtime.sendMessage(body, (result) => {
          let err = '';
          try {
            err = chrome.runtime.lastError?.message || '';
          } catch {
            resolve({ ok: false, error: softReload });
            return;
          }
          if (err) {
            resolve({
              ok: false,
              error: /invalidated|extension context/i.test(err) ? softReload : err,
            });
            return;
          }
          resolve(result && typeof result === 'object' ? result : { ok: false, error: 'empty' });
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'extension';
        resolve({
          ok: false,
          error: /invalidated|extension context/i.test(msg) ? softReload : msg,
        });
      }
    });
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fold(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/đ/g, 'd')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function formatVnd(amount) {
    return `${new Intl.NumberFormat('vi-VN').format(Math.max(0, Math.round(amount || 0)))} đ`;
  }

  function digits(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function moneyOf(value) {
    const text = digits(value);
    if (!text) return 0;
    const n = Number(text);
    return Number.isSafeInteger(n) ? n : 0;
  }

  function groupDigits(value, max = 8) {
    const raw = digits(value).slice(0, max);
    if (!raw) return '';
    return raw.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  function weightKg(weight) {
    const match = String(weight || '')
      .trim()
      .match(/^(\d{1,3})\s*kg$/i);
    if (!match) return null;
    const kg = Number(match[1]);
    return Number.isInteger(kg) && kg > 0 ? kg : null;
  }

  function weightSurchargePercent(weight, basePrice) {
    const kg = weightKg(weight);
    if (kg === null || kg < 16 || !Number.isFinite(basePrice) || basePrice <= 0) return 0;
    const tier = kg <= 35 ? { low: 15, middle: 12, high: 10 } : { low: 20, middle: 15, high: 10 };
    if (basePrice < 150000) return tier.low;
    if (basePrice < 300000) return tier.middle;
    return tier.high;
  }

  function applyWeightPrice(basePrice, weight) {
    const percent = weightSurchargePercent(weight, basePrice);
    if (percent === 0) return basePrice;
    return Math.round((basePrice * (1 + percent / 100)) / 1000) * 1000;
  }

  function shipGroupOf(categorySlug) {
    const slug = fold(categorySlug || '')
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]+/g, '');
    if (slug === 'bi-charm-bac') return 'silver';
    if (slug === 'san-pham-ban-kem') return 'addon';
    if (!slug) return 'other';
    return 'bracelet';
  }

  function qualifiesFreeShip(lines) {
    if (!lines.length) return false;
    if (lines.some((line) => line.group === 'silver')) return false;
    const braceletTotal = lines.filter((line) => line.group === 'bracelet').reduce((sum, line) => sum + line.lineTotal, 0);
    if (braceletTotal >= 100000) return true;
    const hasAddon = lines.some((line) => line.group === 'addon');
    return braceletTotal > 0 && braceletTotal < 100000 && hasAddon;
  }

  function quoteDiscount(choice, subtotal) {
    if (!choice || !Number.isSafeInteger(subtotal) || subtotal <= 0) return 0;
    if (subtotal < (choice.minSubtotal || 0)) return 0;
    if (choice.kind === 'percent') return Math.min(subtotal, Math.floor((subtotal * choice.value) / 100));
    return Math.min(subtotal, choice.value || 0);
  }

  function staffShipDayAfter(days) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const year = Number(parts.find((part) => part.type === 'year')?.value);
    const month = Number(parts.find((part) => part.type === 'month')?.value);
    const day = Number(parts.find((part) => part.type === 'day')?.value);
    const next = new Date(Date.UTC(year, month - 1, day + Math.max(1, days)));
    return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
  }

  function scaleOf(product) {
    const scale = product?.weightScale || 'baby';
    return weightScaleMap.get(scale) || weightScaleMap.get('baby') || { scale: 'none', chips: [], extras: [] };
  }

  function needsWeight(product) {
    const scale = scaleOf(product);
    return (scale.chips?.length || 0) + (scale.extras?.length || 0) > 0;
  }

  async function loadAddressRows() {
    const response = await fetch(chrome.runtime.getURL('data/address-select.json'));
    if (!response.ok) throw new Error('address');
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error('address-shape');
    addressRows = rows;
  }

  function provinceNameOf(code) {
    const row = addressRows.find((item) => item[0] === code);
    return row ? row[1] : '';
  }

  function wardNameOf(provinceCode, wardCode) {
    const row = addressRows.find((item) => item[0] === provinceCode);
    const ward = row?.[2]?.find((item) => item[0] === wardCode);
    return ward ? ward[1] : '';
  }

  function addressOptions(kind) {
    if (kind === 'province') return addressRows.map((row) => [row[0], row[1]]);
    const row = addressRows.find((item) => item[0] === addressSelection.provinceCode);
    return row ? row[2] : [];
  }

  function syncAddressTriggers() {
    const wardTrigger = wardCombo ? comboParts(wardCombo).trigger : null;
    if (wardTrigger instanceof HTMLButtonElement) wardTrigger.disabled = !addressSelection.provinceCode;
    if (provinceCombo instanceof HTMLElement) {
      if (addressSelection.provinceCode) {
        setTriggerLabel(provinceCombo, provinceNameOf(addressSelection.provinceCode) || 'Chọn tỉnh, thành phố', false);
      } else {
        setTriggerLabel(provinceCombo, addressRows.length ? 'Chọn tỉnh, thành phố' : 'Đang tải…', true);
      }
    }
    if (wardCombo instanceof HTMLElement) {
      if (!addressSelection.provinceCode) setTriggerLabel(wardCombo, 'Chọn tỉnh trước', true);
      else if (addressSelection.wardCode) {
        setTriggerLabel(
          wardCombo,
          wardNameOf(addressSelection.provinceCode, addressSelection.wardCode) || 'Chọn phường, xã',
          false,
        );
      } else setTriggerLabel(wardCombo, 'Chọn phường, xã', true);
    }
  }

  function writeAddress() {
    if (!(lineInput instanceof HTMLInputElement) || !(addressValue instanceof HTMLInputElement)) return;
    if (!(provinceValue instanceof HTMLInputElement) || !(wardValue instanceof HTMLInputElement)) return;
    const provinceName = provinceNameOf(addressSelection.provinceCode);
    const wardName = wardNameOf(addressSelection.provinceCode, addressSelection.wardCode);
    const house = lineInput.value.trim();
    provinceValue.value = addressSelection.provinceCode;
    wardValue.value = addressSelection.wardCode;
    if (!addressSelection.provinceCode || !addressSelection.wardCode || !house) {
      addressValue.value = '';
      return;
    }
    const composed = `${house}, ${wardName}, ${provinceName}`;
    addressValue.value = composed.length > 240 ? '' : composed;
  }

  function showWards(selectedWard = '') {
    addressSelection.wardCode = selectedWard || '';
    syncAddressTriggers();
    writeAddress();
  }

  function fillProvinces(selectedProvince = '', selectedWard = '') {
    addressSelection.provinceCode = selectedProvince || '';
    addressSelection.wardCode = selectedProvince ? selectedWard || '' : '';
    syncAddressTriggers();
    writeAddress();
  }

  function applyAddress(input) {
    const provinceCode = typeof input.provinceCode === 'string' ? input.provinceCode : '';
    const wardCode = typeof input.wardCode === 'string' ? input.wardCode : '';
    const line = typeof input.line === 'string' ? input.line : '';
    const keepLine = input.keepLine === true;
    if (!provinceCode) {
      addressSelection.provinceCode = '';
      addressSelection.wardCode = '';
      if (lineInput instanceof HTMLInputElement && !keepLine) lineInput.value = line;
      syncAddressTriggers();
      writeAddress();
      return;
    }
    if (lineInput instanceof HTMLInputElement) lineInput.value = line || (keepLine ? lineInput.value : '');
    fillProvinces(provinceCode, wardCode);
  }

  function applyComposedAddress(text) {
    const flat = String(text || '').replace(/\s+/g, ' ').trim();
    if (!flat) return;
    const parts = flat.split(',').map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2) {
      if (lineInput instanceof HTMLInputElement) lineInput.value = flat.slice(0, 80);
      writeAddress();
      return;
    }
    const provincePart = parts[parts.length - 1] || '';
    const wardPart = parts[parts.length - 2] || '';
    const line = parts.slice(0, -2).join(', ');
    const province = addressRows.find((row) => fold(row[1]) === fold(provincePart) || fold(row[1]).includes(fold(provincePart)));
    if (!province) {
      if (lineInput instanceof HTMLInputElement) lineInput.value = flat.slice(0, 80);
      writeAddress();
      return;
    }
    const ward = province[2].find((item) => fold(item[1]) === fold(wardPart) || fold(item[1]).includes(fold(wardPart)));
    applyAddress({ provinceCode: province[0], wardCode: ward ? ward[0] : '', line: line || '' });
  }

  function renderAddressComboList(combo, kind, queryText) {
    const { list } = comboParts(combo);
    if (!(list instanceof HTMLElement)) return;
    const needle = fold(queryText);
    const selected = kind === 'province' ? addressSelection.provinceCode : addressSelection.wardCode;
    const fragment = document.createDocumentFragment();
    let shown = 0;
    for (const [code, name] of addressOptions(kind)) {
      if (needle && !fold(name).includes(needle)) continue;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'combo-option';
      item.dataset.value = code;
      item.setAttribute('aria-selected', String(code === selected));
      item.textContent = name;
      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
        pickAddress(kind, code);
      });
      fragment.append(item);
      shown += 1;
      if (shown >= 80) break;
    }
    if (!shown) {
      const empty = document.createElement('p');
      empty.className = 'combo-empty';
      empty.textContent = 'Không có kết quả khớp.';
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(fragment);
  }

  function closeAllAddressCombos(except) {
    for (const combo of [provinceCombo, wardCombo]) {
      if (!(combo instanceof HTMLElement) || (except && combo === except)) continue;
      closeCombo(combo);
    }
  }

  function openAddressCombo(combo, kind) {
    const { trigger, panel, query } = comboParts(combo);
    if (trigger instanceof HTMLButtonElement && trigger.disabled) return;
    closeAllAddressCombos(combo);
    closeAllCombos();
    closeLegacyList();
    if (panel instanceof HTMLElement) panel.hidden = false;
    if (trigger instanceof HTMLButtonElement) trigger.setAttribute('aria-expanded', 'true');
    combo.classList.add('is-open');
    renderAddressComboList(combo, kind, '');
    requestAnimationFrame(() => {
      if (query instanceof HTMLInputElement) {
        query.value = '';
        query.focus();
        query.select();
      }
    });
  }

  function pickAddress(kind, code) {
    if (kind === 'province') {
      addressSelection.provinceCode = code;
      addressSelection.wardCode = '';
      clearAddressMap();
      if (provinceCombo instanceof HTMLElement) {
        setTriggerLabel(provinceCombo, provinceNameOf(code), false);
        closeCombo(provinceCombo);
      }
      syncAddressTriggers();
      writeAddress();
      if (wardCombo instanceof HTMLElement) requestAnimationFrame(() => openAddressCombo(wardCombo, 'ward'));
      return;
    }
    addressSelection.wardCode = code;
    clearAddressMap();
    if (wardCombo instanceof HTMLElement) {
      setTriggerLabel(wardCombo, wardNameOf(addressSelection.provinceCode, code), false);
      closeCombo(wardCombo);
    }
    writeAddress();
  }

  function bindAddressCombo(combo, kind) {
    const { trigger, query, panel } = comboParts(combo);
    trigger?.addEventListener('click', () => {
      if (!(panel instanceof HTMLElement)) return;
      if (panel.hidden) openAddressCombo(combo, kind);
      else closeCombo(combo);
    });
    query?.addEventListener('input', () => {
      if (query instanceof HTMLInputElement) renderAddressComboList(combo, kind, query.value);
    });
  }

  function bindAddress() {
    if (provinceCombo instanceof HTMLElement) bindAddressCombo(provinceCombo, 'province');
    if (wardCombo instanceof HTMLElement) bindAddressCombo(wardCombo, 'ward');
    lineInput?.addEventListener('input', () => writeAddress());
    document.addEventListener('mousedown', (event) => {
      if (!(event.target instanceof Node)) return;
      if (addressRoot instanceof HTMLElement && addressRoot.contains(event.target)) {
        for (const combo of [provinceCombo, wardCombo]) {
          if (combo instanceof HTMLElement && !combo.contains(event.target)) closeCombo(combo);
        }
        return;
      }
      closeAllAddressCombos();
    });
  }

  async function runLookup() {
    const phone =
      lookupInput instanceof HTMLInputElement
        ? lookupInput.value.trim()
        : phoneInput instanceof HTMLInputElement
          ? phoneInput.value.trim()
          : '';
    if (!phone) {
      setLookupNote('Nhập số điện thoại để tra.');
      return;
    }
    setLookupNote('Đang tra…');
    const result = await send('vdt-lookup-phone', { phone });
    if (result?.error === 'auth') {
      setLookupNote('Cần đăng nhập admin để tra đơn.');
      return;
    }
    if (!result?.ok) {
      setLookupNote(result?.error || 'Không tra được khách.');
      return;
    }
    if (!result.found || !result.customer) {
      setLookupNote(`Chưa có đơn với ${phone}`);
      if (phoneInput instanceof HTMLInputElement) phoneInput.value = phone;
      return;
    }
    const customer = result.customer;
    if (nameInput instanceof HTMLInputElement && customer.customerName) nameInput.value = customer.customerName;
    if (phoneInput instanceof HTMLInputElement) phoneInput.value = customer.phone || phone;
    if (lookupInput instanceof HTMLInputElement) lookupInput.value = customer.phone || phone;
    if (customer.address) applyComposedAddress(customer.address);
    setLookupNote(customer.orderCount ? `Có ${customer.orderCount} đơn · ${customer.customerName || phone}` : `Đã điền · ${customer.customerName || phone}`);
  }

  function closeLegacyList() {
    show(legacyList, false);
    legacyActive = -1;
  }

  function renderLegacyList() {
    if (!(legacyList instanceof HTMLElement)) return;
    if (!legacyItems.length) {
      legacyList.innerHTML = '';
      closeLegacyList();
      return;
    }
    legacyList.innerHTML = legacyItems
      .map((item, index) => {
        const oldLine = item.oldText ? `<span class="legacy-old">${escapeHtml(item.oldText)}</span>` : '';
        return `<li><button type="button" class="legacy-option${index === legacyActive ? ' is-active' : ''}" data-legacy-index="${index}" role="option">${oldLine}<span class="legacy-new">${escapeHtml(item.newText)}</span></button></li>`;
      })
      .join('');
    show(legacyList, true);
  }

  function pickLegacy(item) {
    if (!item) return;
    applyAddress({
      provinceCode: item.provinceCode,
      wardCode: item.wardCode,
      line: typeof item.line === 'string' ? item.line : '',
      keepLine: !item.line,
    });
    showAddressMap({ oldText: item.oldText, newText: item.newText });
    if (legacyInput instanceof HTMLInputElement) legacyInput.value = '';
    closeLegacyList();
    setLegacyHint(
      item.oldText
        ? `Đã map: ${item.oldText} → ${item.newText}`
        : `Đã chọn ${item.newText}`,
    );
  }

  async function runLegacySearch(query) {
    const q = String(query || '').trim();
    if (q.length < 3) {
      legacyItems = [];
      closeLegacyList();
      setLegacyHint(q ? 'Gõ thêm để tìm…' : '');
      return;
    }
    setLegacyHint('Đang tìm…');
    const data = await send('vdt-legacy-search', { query: q });
    if (!data?.ok) {
      setLegacyHint('Không tìm được. Thử lại.');
      legacyItems = [];
      closeLegacyList();
      return;
    }
    legacyItems = Array.isArray(data.items) ? data.items : [];
    legacyActive = legacyItems.length ? 0 : -1;
    if (!legacyItems.length) {
      setLegacyHint('Không có kết quả khớp.');
      closeLegacyList();
      return;
    }
    setLegacyHint(data.more ? `Hiển thị ${legacyItems.length} kết quả đầu.` : `${legacyItems.length} kết quả.`);
    renderLegacyList();
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
    const { value } = comboParts(combo);
    if (value instanceof HTMLElement) {
      value.textContent = label;
      value.classList.toggle('is-placeholder', empty);
    }
  }

  function closeCombo(combo) {
    const { trigger, panel, query } = comboParts(combo);
    if (panel instanceof HTMLElement) panel.hidden = true;
    if (trigger instanceof HTMLButtonElement) trigger.setAttribute('aria-expanded', 'false');
    combo.classList.remove('is-open');
    if (query instanceof HTMLInputElement) query.value = '';
  }

  function closeAllCombos(except) {
    if (!(legacyManual instanceof HTMLElement)) return;
    for (const combo of legacyManual.querySelectorAll('[data-legacy-combo]')) {
      if (except && combo === except) continue;
      if (combo instanceof HTMLElement) closeCombo(combo);
    }
  }

  function optionsFor(kind) {
    if (!legacyTree) return [];
    if (kind === 'province') return legacyTree.provinces || [];
    if (kind === 'district') return legacyTree.districts?.[manualSelection.province] || [];
    // Tree dùng key `${tỉnh}\t${huyện}` (cùng StaffOrderForm), không phải nested object.
    const key = `${manualSelection.province}\t${manualSelection.district}`;
    const wards = legacyTree.wards?.[key];
    return Array.isArray(wards) ? wards : [];
  }

  function renderComboList(combo, kind, queryText) {
    const { list } = comboParts(combo);
    if (!(list instanceof HTMLElement)) return;
    const needle = fold(queryText);
    const selected = manualSelection[kind];
    const fragment = document.createDocumentFragment();
    let shown = 0;
    for (const name of optionsFor(kind)) {
      if (needle && !fold(name).includes(needle)) continue;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'combo-option';
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
      empty.className = 'combo-empty';
      empty.textContent = 'Không có kết quả khớp.';
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(fragment);
  }

  function syncDependentTriggers() {
    const district = legacyRoot?.querySelector('[data-legacy-combo="district"]');
    const ward = legacyRoot?.querySelector('[data-legacy-combo="ward"]');
    const districtTrigger = district ? comboParts(district).trigger : null;
    const wardTrigger = ward ? comboParts(ward).trigger : null;
    if (districtTrigger instanceof HTMLButtonElement) districtTrigger.disabled = !manualSelection.province;
    if (wardTrigger instanceof HTMLButtonElement) wardTrigger.disabled = !manualSelection.district;
    if (!manualSelection.province) {
      if (district instanceof HTMLElement) setTriggerLabel(district, 'Chọn tỉnh trước', true);
      if (ward instanceof HTMLElement) setTriggerLabel(ward, 'Chọn huyện trước', true);
    } else if (!manualSelection.district) {
      if (district instanceof HTMLElement) setTriggerLabel(district, 'Chọn quận/huyện', true);
      if (ward instanceof HTMLElement) setTriggerLabel(ward, 'Chọn huyện trước', true);
    } else if (!manualSelection.ward && ward instanceof HTMLElement) {
      setTriggerLabel(ward, 'Chọn phường/xã', true);
    }
  }

  function resetManualSelection() {
    manualSelection.province = '';
    manualSelection.district = '';
    manualSelection.ward = '';
    const province = legacyRoot?.querySelector('[data-legacy-combo="province"]');
    if (province instanceof HTMLElement) setTriggerLabel(province, 'Chọn tỉnh/TP cũ', true);
    syncDependentTriggers();
  }

  async function applyManualSelection() {
    if (!manualSelection.province || !manualSelection.district || !manualSelection.ward) return;
    const data = await send('vdt-legacy-resolve', { selection: { ...manualSelection } });
    if (!data?.ok || !data.item) {
      setLegacyHint('Không khớp được địa chỉ 2 cấp cho lựa chọn này.');
      return;
    }
    pickLegacy(data.item);
    resetManualSelection();
  }

  function pickManual(kind, name) {
    manualSelection[kind] = name;
    const combo = legacyRoot?.querySelector(`[data-legacy-combo="${kind}"]`);
    if (combo instanceof HTMLElement) {
      setTriggerLabel(combo, name, false);
      closeCombo(combo);
    }
    if (kind === 'province') {
      manualSelection.district = '';
      manualSelection.ward = '';
      syncDependentTriggers();
      const district = legacyRoot?.querySelector('[data-legacy-combo="district"]');
      if (district instanceof HTMLElement) requestAnimationFrame(() => openCombo(district, 'district'));
      return;
    }
    if (kind === 'district') {
      manualSelection.ward = '';
      syncDependentTriggers();
      const ward = legacyRoot?.querySelector('[data-legacy-combo="ward"]');
      if (ward instanceof HTMLElement) requestAnimationFrame(() => openCombo(ward, 'ward'));
      return;
    }
    void applyManualSelection();
  }

  function openCombo(combo, kind) {
    const { trigger, panel, query } = comboParts(combo);
    if (trigger instanceof HTMLButtonElement && trigger.disabled) return;
    closeAllCombos(combo);
    closeAllAddressCombos();
    closeLegacyList();
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
  }

  async function ensureLegacyTree() {
    if (legacyTree) return legacyTree;
    const data = await send('vdt-legacy-tree');
    if (!data?.ok || !data.tree) throw new Error('tree');
    legacyTree = data.tree;
    return legacyTree;
  }

  function bindLegacy() {
    if (!(legacyRoot instanceof HTMLElement)) return;
    legacyInput?.addEventListener('input', () => {
      window.clearTimeout(legacyTimer);
      legacyTimer = window.setTimeout(() => {
        void runLegacySearch(legacyInput instanceof HTMLInputElement ? legacyInput.value : '');
      }, 180);
    });
    legacyInput?.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' && legacyItems.length) {
        event.preventDefault();
        legacyActive = Math.min(legacyItems.length - 1, legacyActive + 1);
        renderLegacyList();
      } else if (event.key === 'ArrowUp' && legacyItems.length) {
        event.preventDefault();
        legacyActive = Math.max(0, legacyActive - 1);
        renderLegacyList();
      } else if (event.key === 'Enter' && legacyActive >= 0 && legacyItems[legacyActive]) {
        event.preventDefault();
        pickLegacy(legacyItems[legacyActive]);
      } else if (event.key === 'Escape') closeLegacyList();
    });
    legacyList?.addEventListener('click', (event) => {
      const button = event.target instanceof Element ? event.target.closest('[data-legacy-index]') : null;
      if (!(button instanceof HTMLElement)) return;
      const index = Number(button.dataset.legacyIndex);
      if (Number.isInteger(index)) pickLegacy(legacyItems[index]);
    });
    for (const kind of ['province', 'district', 'ward']) {
      const combo = legacyRoot.querySelector(`[data-legacy-combo="${kind}"]`);
      if (combo instanceof HTMLElement) bindManualCombo(combo, kind);
    }
    syncDependentTriggers();
    legacyToggle?.addEventListener('click', () => {
      if (!(legacyManual instanceof HTMLElement) || !(legacyToggle instanceof HTMLElement)) return;
      const open = legacyManual.hasAttribute('hidden');
      legacyManual.hidden = !open;
      legacyToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (!open) {
        closeAllCombos();
        return;
      }
      void ensureLegacyTree()
        .then(() => syncDependentTriggers())
        .catch(() => setLegacyHint('Không tải được danh sách địa chỉ. Tải lại extension.'));
    });
    document.addEventListener('mousedown', (event) => {
      if (!(event.target instanceof Node) || !legacyManual?.contains(event.target)) {
        closeAllCombos();
        return;
      }
      for (const kind of ['province', 'district', 'ward']) {
        const combo = legacyRoot.querySelector(`[data-legacy-combo="${kind}"]`);
        if (combo instanceof HTMLElement && !combo.contains(event.target)) closeCombo(combo);
      }
    });
  }

  function filteredProducts() {
    const needle = fold(pickText);
    let list = products.slice();
    if (pickCategory === 'hot') list = list.slice(0, 10);
    else if (pickCategory !== 'all') list = list.filter((item) => String(item.categoryId) === pickCategory);
    if (needle) list = list.filter((item) => fold(item.name).includes(needle));
    return list.slice(0, 40);
  }

  function renderPickCats() {
    if (!(pickCats instanceof HTMLElement) || !bootstrap) return;
    const cats = [{ id: 'hot', name: 'Bán chạy' }, { id: 'all', name: 'Tất cả' }, ...(bootstrap.categories || [])];
    pickCats.innerHTML = cats
      .map((cat) => {
        const id = String(cat.id);
        return `<button type="button" class="pick-cat" data-cat="${escapeHtml(id)}" aria-pressed="${id === pickCategory}">${escapeHtml(cat.name)}</button>`;
      })
      .join('');
  }

  function productInCart(productId) {
    return cart.some((line) => Number(line.productId) === Number(productId));
  }

  function clampPickQty(raw) {
    const n = Number(String(raw || '').replace(/\D/g, ''));
    if (!Number.isInteger(n) || n < 1) return 1;
    return Math.min(20, n);
  }

  function closePickPanel() {
    pendingProduct = null;
    pendingWeight = '';
    pendingQty = 1;
    pendingNote = '';
    extraOpen = false;
  }

  function openPickPanel(product) {
    pendingProduct = product;
    pendingWeight = '';
    pendingQty = 1;
    pendingNote = '';
    extraOpen = false;
  }

  function syncPickDraft(panel) {
    if (!(panel instanceof HTMLElement)) return;
    const noteInput = panel.querySelector('[data-weight-note]');
    const qtyInput = panel.querySelector('[data-weight-qty]');
    if (noteInput instanceof HTMLInputElement) pendingNote = noteInput.value.trim().slice(0, 160);
    if (qtyInput instanceof HTMLInputElement) pendingQty = clampPickQty(qtyInput.value);
  }

  function stepWeight(delta) {
    if (!pendingProduct || !needsWeight(pendingProduct)) return;
    const chips = scaleOf(pendingProduct).chips || [];
    if (!chips.length) return;
    const idx = chips.indexOf(pendingWeight);
    if (delta < 0) {
      if (idx <= 0) {
        selectWeight('');
        return;
      }
      selectWeight(chips[idx - 1]);
      return;
    }
    const next = idx < 0 ? 0 : Math.min(chips.length - 1, idx + 1);
    selectWeight(chips[next]);
  }

  function renderPickPanel(product) {
    const weigh = needsWeight(product);
    const scale = scaleOf(product);
    const chips = scale.chips || [];
    const extras = scale.extras || [];
    const noteField = `<div class="pick-panel-top">
      <input class="field" maxlength="160" placeholder="Lưu ý sản phẩm…" data-weight-note value="${escapeHtml(pendingNote)}" />
    </div>`;
    const weightBlock = weigh
      ? `${noteField}
        <div class="chips pick-chips" data-weight-chips>
          <button type="button" class="chip weight-step" data-weight-step="-1" aria-label="Giảm cân nặng">−</button>
          ${chips
            .map(
              (label) =>
                `<button type="button" class="chip" data-weight-chip="${escapeHtml(label)}" aria-pressed="${label === pendingWeight}">${escapeHtml(label)}</button>`,
            )
            .join('')}
          ${
            extras.length
              ? `<button type="button" class="chip weight-extra-toggle" data-weight-extra-toggle aria-expanded="${extraOpen}" title="Cân nặng khác" aria-label="Cân nặng khác">+</button>`
              : ''
          }
        </div>
        <label class="weight-extra-field" data-weight-extra-wrap ${extraOpen ? '' : 'hidden'}>
          <span class="label">Cân nặng khác</span>
          <select class="field" data-weight-extra>
            <option value="">Chọn…</option>
            ${extras
              .map(
                (label) =>
                  `<option value="${escapeHtml(label)}" ${label === pendingWeight ? 'selected' : ''}>${escapeHtml(label)}</option>`,
              )
              .join('')}
          </select>
        </label>`
      : noteField;

    return `<div class="pick-panel" data-pick-panel>
      ${weightBlock}
      <div class="pick-panel-actions">
        <div class="qty-box qty-box-wide">
          <button type="button" class="qty-btn" data-weight-qty-dec aria-label="Giảm số lượng">−</button>
          <input class="qty-value" type="text" inputmode="numeric" maxlength="2" value="${pendingQty}" data-weight-qty aria-label="Số lượng" />
          <button type="button" class="qty-btn" data-weight-qty-inc aria-label="Tăng số lượng">+</button>
        </div>
        <button type="button" class="btn btn-primary pick-add" data-weight-add>Thêm vào đơn</button>
      </div>
    </div>`;
  }

  function renderPickList() {
    if (!(pickList instanceof HTMLElement)) return;
    const list = filteredProducts();
    show(pickEmpty, list.length === 0);
    pickList.innerHTML = list
      .map((product) => {
        const added = productInCart(product.id);
        const open = pendingProduct && Number(pendingProduct.id) === Number(product.id);
        const sold = Math.max(0, Math.floor(Number(product.sold) || 0));
        const soldLabel = sold.toLocaleString('vi-VN');
        const photo = product.coverUrl
          ? `<img class="pick-photo" src="${escapeHtml(product.coverUrl)}" alt="" width="72" height="72" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-fallback="1" />`
          : `<span class="pick-photo is-empty" aria-hidden="true">SP</span>`;
        return `<div class="pick-card${open ? ' is-open' : ''}${added ? ' is-added' : ''}" data-pick-card="${product.id}">
          <button type="button" class="pick-item" data-pick-toggle="${product.id}" aria-expanded="${open ? 'true' : 'false'}">
            ${photo}
            <span class="pick-copy">
              <span class="pick-name">${escapeHtml(product.name)}</span>
              <span class="pick-meta">
                <span class="pick-price">${escapeHtml(formatVnd(product.price))}</span>
                <span class="pick-sold">Lượt bán ${escapeHtml(soldLabel)}</span>
                ${added ? '<span class="pick-added">đã thêm</span>' : ''}
              </span>
            </span>
            <span class="pick-chevron" aria-hidden="true"></span>
          </button>
          ${open ? renderPickPanel(product) : ''}
        </div>`;
      })
      .join('');
  }

  function selectWeight(label) {
    pendingWeight = label;
    if (!(pickList instanceof HTMLElement)) return;
    for (const chip of pickList.querySelectorAll('[data-weight-chip]')) {
      chip.setAttribute('aria-pressed', String(chip.getAttribute('data-weight-chip') === label));
    }
    const extra = pickList.querySelector('[data-weight-extra]');
    if (extra instanceof HTMLSelectElement && extra.value !== label) extra.value = label;
  }

  function lineCoverUrl(line) {
    const direct = String(line?.coverUrl || '').trim();
    if (direct) return direct;
    const product = products.find((item) => Number(item.id) === Number(line?.productId));
    return String(product?.coverUrl || '').trim();
  }

  function cartLinePhotoHtml(line) {
    const url = lineCoverUrl(line);
    if (url) {
      return `<img class="cart-photo" src="${escapeHtml(url)}" alt="" width="48" height="48" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-fallback="1" />`;
    }
    return `<span class="cart-photo is-empty" aria-hidden="true">SP</span>`;
  }

  function addToCart(product, weight, quantity, note) {
    const unitPrice = applyWeightPrice(product.price, weight);
    const key = `${product.id}|${weight}|${note}`;
    const existing = cart.find((line) => line.key === key);
    if (existing) {
      existing.quantity = Math.min(20, existing.quantity + quantity);
      if (!existing.coverUrl && product.coverUrl) existing.coverUrl = product.coverUrl;
    } else {
      cart.push({
        key,
        productId: product.id,
        name: product.name,
        weight,
        quantity,
        note,
        unitPrice,
        categorySlug: product.categorySlug || '',
        coverUrl: product.coverUrl || '',
      });
    }
    renderCart();
    paintPay();
  }

  /** @type {{ index: number, field: 'qty' | 'note' } | null} */
  let cartEdit = null;

  function focusCartEdit() {
    if (!cartEdit || !(cartEl instanceof HTMLElement)) return;
    const row = cartEl.querySelector(`[data-cart-index="${cartEdit.index}"]`);
    if (!(row instanceof HTMLElement)) return;
    const input =
      cartEdit.field === 'qty'
        ? row.querySelector('[data-cart-qty]')
        : row.querySelector('[data-cart-note]');
    if (!(input instanceof HTMLInputElement)) return;
    try {
      input.focus();
      input.select();
    } catch {
      /* ignore */
    }
  }

  /** @param {{ keepEdit?: boolean }} [opts] */
  function renderCart(opts = {}) {
    if (!(cartEl instanceof HTMLElement)) return;
    if (!opts.keepEdit) cartEdit = null;
    if (cartEdit && (cartEdit.index < 0 || cartEdit.index >= cart.length)) cartEdit = null;
    show(cartEmpty, cart.length === 0);
    cartEl.innerHTML = cart
      .map((line, index) => {
        const sub = [line.weight, formatVnd(line.unitPrice)].filter(Boolean).join(' · ');
        const editingQty = cartEdit?.index === index && cartEdit.field === 'qty';
        const editingNote = cartEdit?.index === index && cartEdit.field === 'note';
        const noteText = String(line.note || '').trim();
        const qtyBlock = editingQty
          ? `<div class="qty-box">
              <button type="button" class="qty-btn" data-cart-dec aria-label="Giảm">−</button>
              <input class="qty-value" data-cart-qty inputmode="numeric" maxlength="2" value="${line.quantity}" aria-label="Số lượng" />
              <button type="button" class="qty-btn" data-cart-inc aria-label="Tăng">+</button>
            </div>`
          : `<button type="button" class="cart-info cart-info-qty" data-cart-edit-qty title="Bấm để sửa số lượng">SL ×${line.quantity}</button>`;
        const noteBlock = editingNote
          ? `<input class="field cart-note-input" data-cart-note maxlength="160" placeholder="Ghi chú dòng" value="${escapeHtml(noteText)}" />`
          : `<button type="button" class="cart-info cart-info-note${noteText ? '' : ' is-empty'}" data-cart-edit-note title="Bấm để sửa ghi chú">${noteText ? escapeHtml(noteText) : 'Thêm ghi chú'}</button>`;
        return `<li class="cart-item" data-cart-index="${index}">
          <div class="cart-top">
            ${cartLinePhotoHtml(line)}
            <div class="cart-copy">
              <div class="cart-name">${escapeHtml(line.name)}</div>
              <div class="cart-sub">${escapeHtml(sub)}</div>
            </div>
            <button type="button" class="cart-remove" data-cart-remove>Xóa</button>
          </div>
          <div class="cart-controls">
            ${qtyBlock}
            ${noteBlock}
            <strong>${escapeHtml(formatVnd(line.unitPrice * line.quantity))}</strong>
          </div>
        </li>`;
      })
      .join('');
    if (opts.keepEdit && cartEdit) queueMicrotask(() => focusCartEdit());
  }

  function beginCartEdit(index, field) {
    if (!Number.isInteger(index) || index < 0 || index >= cart.length) return;
    if (field !== 'qty' && field !== 'note') return;
    cartEdit = { index, field };
    renderCart({ keepEdit: true });
  }

  function commitCartQty(input, index) {
    const line = cart[index];
    if (!line) return;
    const n = Number(input instanceof HTMLInputElement ? input.value : NaN);
    line.quantity = Number.isInteger(n) && n >= 1 && n <= 20 ? n : 1;
  }

  function commitCartNote(input, index) {
    const line = cart[index];
    if (!line) return;
    line.note = String(input instanceof HTMLInputElement ? input.value : '')
      .trim()
      .slice(0, 160);
    line.key = `${line.productId}|${line.weight}|${line.note}`;
  }

  function endCartEdit(opts = {}) {
    cartEdit = null;
    renderCart();
    if (opts.paint !== false) paintPay();
  }

  function cartSubtotal() {
    return cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  }

  function selectedDiscount() {
    if (!(discountCode instanceof HTMLSelectElement) || !discountCode.value || !bootstrap) return null;
    return (bootstrap.discountChoices || []).find((item) => item.code === discountCode.value) || null;
  }

  function computePayState() {
    const subtotal = cartSubtotal();
    const codeAmount = quoteDiscount(selectedDiscount(), subtotal);
    const room = Math.max(0, subtotal - codeAmount);
    const extra = Math.min(room, moneyOf(discountExtra instanceof HTMLInputElement ? discountExtra.value : ''));
    const goods = Math.max(0, room - extra);
    const shipLines = cart.map((line) => ({
      group: shipGroupOf(line.categorySlug),
      lineTotal: line.unitPrice * line.quantity,
    }));
    const autoFree = qualifiesFreeShip(shipLines);
    const compensation = compensationEl instanceof HTMLInputElement && compensationEl.checked;
    if (freeShipEl instanceof HTMLInputElement) {
      if (autoFree) freeShipEl.checked = true;
    }
    const free = (freeShipEl instanceof HTMLInputElement && freeShipEl.checked) || autoFree || compensation;
    if (shipFeeEl instanceof HTMLInputElement) {
      shipFeeEl.disabled = free;
      if (free) shipFeeEl.value = '';
      else if (!shipFeeEl.value && defaultShipFee) shipFeeEl.value = defaultShipFee;
    }
    const ship = free ? 0 : moneyOf(shipFeeEl instanceof HTMLInputElement ? shipFeeEl.value : '');
    const lockedTotal = orderTotal instanceof HTMLInputElement ? moneyOf(orderTotal.value) : 0;
    const payable = compensation ? 0 : lockedTotal > 0 ? lockedTotal + ship : goods + ship;
    return { subtotal, codeAmount, extra, ship, free, compensation, payable };
  }

  function compactVnd(amount) {
    return `${new Intl.NumberFormat('vi-VN').format(Math.max(0, Math.round(amount || 0)))}đ`;
  }

  function payStateLabel(value) {
    const found = (bootstrap?.payStates || []).find((item) => item.value === value);
    if (found?.label) return found.label;
    if (value === 'cod') return 'Nhận hàng thanh toán';
    if (value === 'transfer') return 'Chuyển khoản';
    if (value === 'deposit') return 'Cọc';
    return 'Nhận hàng thanh toán';
  }

  function buildConfirmMessages() {
    writeAddress();
    const name = nameInput instanceof HTMLInputElement ? nameInput.value.trim() : '';
    const phone = phoneInput instanceof HTMLInputElement ? phoneInput.value.trim() : '';
    const address = addressValue instanceof HTMLInputElement ? addressValue.value.trim() : '';
    const payRadio = document.querySelector('input[name="payState"]:checked');
    const payValue = payRadio instanceof HTMLInputElement ? payRadio.value : 'cod';
    const payState = computePayState();
    const productLines = cart
      .map((line, index) => {
        const qty = Number(line.quantity) > 0 ? Number(line.quantity) : 1;
        const size = String(line.weight || '').trim();
        const parts = [`${index + 1}. ${line.name}`, `SL: ${qty} chiếc`];
        if (size) parts.push(`Size: ${size}`);
        return parts.join('  ·  ');
      })
      .join('\n');
    const totalPart = payState.free
      ? `${compactVnd(payState.payable)} (Miễn phí vận chuyển)`
      : payState.ship > 0
        ? `${compactVnd(payState.payable)} (gồm ship ${compactVnd(payState.ship)})`
        : compactVnd(payState.payable);
    const msg1 = [
      '—— XÁC NHẬN THÔNG TIN ——',
      '',
      `- Tên người nhận: ${name}`,
      `- SĐT: ${phone}`,
      '',
      '- Sản phẩm:',
      productLines || '(chưa có sản phẩm)',
      '',
      '- Địa chỉ sau xác nhập:',
      address || '(chưa có địa chỉ)',
      '',
      `- Tổng tiền: ${totalPart}`,
      `- Thanh toán: ${payStateLabel(payValue)}`,
    ].join('\n');
    const msg2 = 'Phiền c kiểm tra và xác nhận thông tin giúp em với nha để em lưu đơn lại chị ha';
    return [msg1, msg2];
  }

  function paintPay() {
    const { subtotal, codeAmount, extra, ship, free, compensation, payable } = computePayState();
    if (paySummary instanceof HTMLElement) {
      paySummary.textContent = compensation
        ? 'Gửi bù · không thu tiền.'
        : `Tạm tính ${formatVnd(subtotal)}${codeAmount ? ` · mã −${formatVnd(codeAmount)}` : ''}${extra ? ` · giảm thêm −${formatVnd(extra)}` : ''}${ship ? ` · ship ${formatVnd(ship)}` : free ? ' · miễn ship' : ''} · thu ${formatVnd(payable)}`;
    }
    if (orderGrandTotal instanceof HTMLElement) {
      orderGrandTotal.textContent = compensation ? '0đ' : compactVnd(payable);
    }
  }

  /** Đưa box Sản phẩm lên đầu panel + card vừa mở lên đầu list. */
  function scrollOpenedPickToTop(card) {
    if (!(card instanceof HTMLElement) || !(pickList instanceof HTMLElement)) return;
    const section =
      card.closest('[data-section="products"]') || document.querySelector('[data-section="products"]');
    if (section instanceof HTMLElement) {
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    const listRect = pickList.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const nextTop = pickList.scrollTop + (cardRect.top - listRect.top);
    pickList.scrollTo({ top: Math.max(0, nextTop), behavior: 'smooth' });
  }

  function scrollCartSectionIntoView() {
    const section = document.querySelector('[data-section="cart"]');
    if (!(section instanceof HTMLElement)) return;
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function bindProducts() {
    pickCats?.addEventListener('click', (event) => {
      const button = event.target instanceof Element ? event.target.closest('[data-cat]') : null;
      if (!(button instanceof HTMLElement)) return;
      pickCategory = button.dataset.cat || 'hot';
      renderPickCats();
      renderPickList();
    });
    pickQuery?.addEventListener('input', () => {
      pickText = pickQuery instanceof HTMLInputElement ? pickQuery.value : '';
      renderPickList();
    });
    pickList?.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const toggle = target.closest('[data-pick-toggle]');
      if (toggle instanceof HTMLElement) {
        const openPanel = pickList.querySelector('[data-pick-panel]');
        if (openPanel instanceof HTMLElement) syncPickDraft(openPanel);
        const product = products.find((item) => String(item.id) === toggle.getAttribute('data-pick-toggle'));
        if (!product) return;
        if (pendingProduct && Number(pendingProduct.id) === Number(product.id)) {
          closePickPanel();
          renderPickList();
          return;
        }
        openPickPanel(product);
        renderPickList();
        const opened = pickList.querySelector('.pick-card.is-open');
        if (opened instanceof HTMLElement) {
          requestAnimationFrame(() => scrollOpenedPickToTop(opened));
        }
        return;
      }

      if (!pendingProduct) return;
      const panel = target.closest('[data-pick-panel]');
      if (!(panel instanceof HTMLElement)) return;

      const chip = target.closest('[data-weight-chip]');
      if (chip instanceof HTMLElement) {
        selectWeight(chip.getAttribute('data-weight-chip') || '');
        return;
      }

      const step = target.closest('[data-weight-step]');
      if (step instanceof HTMLElement) {
        stepWeight(Number(step.getAttribute('data-weight-step') || '-1'));
        return;
      }

      const extraToggle = target.closest('[data-weight-extra-toggle]');
      if (extraToggle instanceof HTMLElement) {
        syncPickDraft(panel);
        extraOpen = !extraOpen;
        renderPickList();
        return;
      }

      if (target.closest('[data-weight-qty-dec]')) {
        pendingQty = clampPickQty(pendingQty - 1);
        const input = panel.querySelector('[data-weight-qty]');
        if (input instanceof HTMLInputElement) input.value = String(pendingQty);
        return;
      }
      if (target.closest('[data-weight-qty-inc]')) {
        pendingQty = clampPickQty(pendingQty + 1);
        const input = panel.querySelector('[data-weight-qty]');
        if (input instanceof HTMLInputElement) input.value = String(pendingQty);
        return;
      }

      if (target.closest('[data-weight-add]')) {
        syncPickDraft(panel);
        if (needsWeight(pendingProduct) && !pendingWeight) {
          setFormError('Chọn cân nặng trước khi thêm.');
          return;
        }
        addToCart(pendingProduct, pendingWeight, pendingQty, pendingNote);
        closePickPanel();
        renderPickList();
        setFormError('');
        requestAnimationFrame(() => scrollCartSectionIntoView());
      }
    });

    pickList?.addEventListener('change', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLSelectElement) && !(target instanceof HTMLInputElement)) return;
      if (!pendingProduct) return;
      if (target.hasAttribute('data-weight-extra')) {
        if (target.value) selectWeight(target.value);
        return;
      }
      if (target.hasAttribute('data-weight-note')) pendingNote = target.value.trim().slice(0, 160);
      if (target.hasAttribute('data-weight-qty')) {
        pendingQty = clampPickQty(target.value);
        target.value = String(pendingQty);
      }
    });

    pickList?.addEventListener(
      'error',
      (event) => {
        const img = event.target;
        if (!(img instanceof HTMLImageElement) || img.dataset.fallback !== '1') return;
        const span = document.createElement('span');
        span.className = 'pick-photo is-empty';
        span.setAttribute('aria-hidden', 'true');
        span.textContent = 'SP';
        img.replaceWith(span);
      },
      true,
    );
    cartEl?.addEventListener(
      'error',
      (event) => {
        const img = event.target;
        if (!(img instanceof HTMLImageElement) || img.dataset.fallback !== '1') return;
        const span = document.createElement('span');
        span.className = 'cart-photo is-empty';
        span.setAttribute('aria-hidden', 'true');
        span.textContent = 'SP';
        img.replaceWith(span);
      },
      true,
    );
    cartEl?.addEventListener('click', (event) => {
      const row = event.target instanceof Element ? event.target.closest('[data-cart-index]') : null;
      if (!(row instanceof HTMLElement)) return;
      const index = Number(row.dataset.cartIndex);
      const line = cart[index];
      if (!line) return;
      if (event.target instanceof Element && event.target.closest('[data-cart-remove]')) {
        cart.splice(index, 1);
        cartEdit = null;
        renderCart();
        renderPickList();
        paintPay();
        return;
      }
      if (event.target instanceof Element && event.target.closest('[data-cart-edit-qty]')) {
        beginCartEdit(index, 'qty');
        return;
      }
      if (event.target instanceof Element && event.target.closest('[data-cart-edit-note]')) {
        beginCartEdit(index, 'note');
        return;
      }
      if (event.target instanceof Element && event.target.closest('[data-cart-dec]')) {
        line.quantity = Math.max(1, line.quantity - 1);
        cartEdit = { index, field: 'qty' };
        renderCart({ keepEdit: true });
        paintPay();
        return;
      }
      if (event.target instanceof Element && event.target.closest('[data-cart-inc]')) {
        line.quantity = Math.min(20, line.quantity + 1);
        cartEdit = { index, field: 'qty' };
        renderCart({ keepEdit: true });
        paintPay();
      }
    });
    cartEl?.addEventListener('change', (event) => {
      const row = event.target instanceof Element ? event.target.closest('[data-cart-index]') : null;
      if (!(row instanceof HTMLElement)) return;
      const index = Number(row.dataset.cartIndex);
      if (!cart[index]) return;
      if (event.target instanceof HTMLInputElement && event.target.hasAttribute('data-cart-qty')) {
        commitCartQty(event.target, index);
        paintPay();
      }
    });
    cartEl?.addEventListener('keydown', (event) => {
      if (!(event.target instanceof HTMLInputElement)) return;
      const row = event.target.closest('[data-cart-index]');
      if (!(row instanceof HTMLElement)) return;
      const index = Number(row.dataset.cartIndex);
      if (!cart[index]) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        endCartEdit();
        return;
      }
      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (event.target.hasAttribute('data-cart-qty')) commitCartQty(event.target, index);
      if (event.target.hasAttribute('data-cart-note')) commitCartNote(event.target, index);
      endCartEdit();
    });
    cartEl?.addEventListener('focusout', (event) => {
      if (!cartEdit) return;
      const row = event.target instanceof Element ? event.target.closest('[data-cart-index]') : null;
      if (!(row instanceof HTMLElement)) return;
      const index = Number(row.dataset.cartIndex);
      if (cartEdit.index !== index) return;
      // Còn focus trong cùng dòng đang sửa (vd. bấm +/-) → giữ chế độ sửa.
      const next = event.relatedTarget;
      if (next instanceof Node && row.contains(next)) return;
      if (event.target instanceof HTMLInputElement && event.target.hasAttribute('data-cart-qty')) {
        commitCartQty(event.target, index);
      }
      if (event.target instanceof HTMLInputElement && event.target.hasAttribute('data-cart-note')) {
        commitCartNote(event.target, index);
      }
      endCartEdit();
    });
    discountCode?.addEventListener('change', () => paintPay());
    discountExtra?.addEventListener('input', () => {
      if (discountExtra instanceof HTMLInputElement) discountExtra.value = groupDigits(discountExtra.value);
      paintPay();
    });
    orderTotal?.addEventListener('input', () => {
      if (orderTotal instanceof HTMLInputElement) orderTotal.value = groupDigits(orderTotal.value, 9);
      paintPay();
    });

    const paySection = document.querySelector('[data-section="pay"]');
    const payToggle = document.querySelector('[data-pay-toggle]');
    const payBody = document.querySelector('[data-discount]');
    payToggle?.addEventListener('click', () => {
      if (!(paySection instanceof HTMLElement) || !(payBody instanceof HTMLElement)) return;
      const open = paySection.classList.toggle('is-collapsed') === false;
      payBody.hidden = !open;
      payToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  function bindMeta() {
    const syncFlags = () => {
      const pay = document.querySelector('input[name="payState"]:checked');
      const depositOn = pay instanceof HTMLInputElement && pay.value === 'deposit';
      show(depositBox, depositOn);
      const later = shipLaterEl instanceof HTMLInputElement && shipLaterEl.checked;
      show(shipDateBox, later);
      if (priorityEl instanceof HTMLInputElement) priorityEl.disabled = later && !priorityEl.checked;
      if (shipLaterEl instanceof HTMLInputElement) shipLaterEl.disabled = priorityEl instanceof HTMLInputElement && priorityEl.checked && !later;
      paintPay();
    };
    payStatesEl?.addEventListener('change', syncFlags);
    compensationEl?.addEventListener('change', syncFlags);
    priorityEl?.addEventListener('change', syncFlags);
    shipLaterEl?.addEventListener('change', syncFlags);
    freeShipEl?.addEventListener('change', () => paintPay());
    shipFeeEl?.addEventListener('input', () => {
      if (shipFeeEl instanceof HTMLInputElement) shipFeeEl.value = groupDigits(shipFeeEl.value);
      paintPay();
    });
    depositAmount?.addEventListener('input', () => {
      if (depositAmount instanceof HTMLInputElement) depositAmount.value = groupDigits(depositAmount.value);
    });
    shipPresetsEl?.addEventListener('click', (event) => {
      const button = event.target instanceof Element ? event.target.closest('[data-ship-preset]') : null;
      if (!(button instanceof HTMLElement) || !(shipOnEl instanceof HTMLInputElement)) return;
      const days = Number(button.dataset.shipPreset);
      if (!Number.isInteger(days)) return;
      shipOnEl.value = staffShipDayAfter(days);
    });
  }

  function renderMeta(data) {
    if (payStatesEl instanceof HTMLElement) {
      payStatesEl.innerHTML = (data.payStates || [])
        .map(
          (item, index) =>
            `<label class="preset"><input type="radio" name="payState" value="${escapeHtml(item.value)}" ${index === 0 ? 'checked' : ''} /><span>${escapeHtml(item.label)}</span></label>`,
        )
        .join('');
    }
    if (sourcesEl instanceof HTMLElement) {
      sourcesEl.innerHTML = (data.sources || [])
        .map((item) => `<label class="preset"><input type="radio" name="source" value="${escapeHtml(item.value)}" /><span>${escapeHtml(item.label)}</span></label>`)
        .join('');
    }
    if (shipPresetsEl instanceof HTMLElement) {
      shipPresetsEl.innerHTML = (data.shipDayPresets || [])
        .map((days) => `<button type="button" class="preset" data-ship-preset="${days}"><span>${days} ngày</span></button>`)
        .join('');
    }
    if (discountCode instanceof HTMLSelectElement) {
      discountCode.replaceChildren(new Option('Không dùng mã', ''));
      for (const choice of data.discountChoices || []) {
        const label =
          choice.kind === 'percent' ? `${choice.code} (−${choice.value}%)` : `${choice.code} (−${formatVnd(choice.value)})`;
        discountCode.add(new Option(label, choice.code));
      }
    }
    defaultShipFee = data.defaultShippingFee || '';
    if (shipFeeEl instanceof HTMLInputElement) shipFeeEl.value = defaultShipFee;
    if (shipNoteEl instanceof HTMLElement) {
      const costs = data.shippingCosts || [];
      shipNoteEl.textContent =
        costs.length === 0
          ? 'Phí ship vốn chưa khai trong chi phí đơn.'
          : `Phí ship vốn: ${costs.map((cost) => `${cost.name}`).join(', ')}.`;
    }
    show(depositBox, false);
    show(shipDateBox, false);
    paintPay();
  }

  function resolveCoverUrl(cover, origin = '') {
    let value = typeof cover === 'string' ? cover.trim() : '';
    if (!value) return null;
    if (value.startsWith('chrome-extension:')) {
      const idx = value.indexOf('/media/');
      value = idx >= 0 ? value.slice(idx) : '';
      if (!value) return null;
    }
    if (/^https?:\/\//i.test(value)) return value;
    const base = String(origin || bootstrap?.adminOrigin || '').replace(/\/$/, '');
    if (!base) return null;
    return `${base}${value.startsWith('/') ? '' : '/'}${value}`;
  }

  function withMediaOrigin(list, origin = '') {
    return list.map((product) => {
      const coverUrl = resolveCoverUrl(product.coverUrl, origin);
      return coverUrl === product.coverUrl ? product : { ...product, coverUrl };
    });
  }

  function initCatalog(data) {
    products = withMediaOrigin(Array.isArray(data.products) ? data.products : [], data.adminOrigin || '');
    weightScaleMap = new Map((data.weightScales || []).map((item) => [item.scale, item]));
    pickCategory = 'hot';
    pickText = '';
    if (pickQuery instanceof HTMLInputElement) pickQuery.value = '';
    renderPickCats();
    renderPickList();
    renderCart();
    renderMeta(data);
  }

  function collectDraft() {
    writeAddress();
    const pay = document.querySelector('input[name="payState"]:checked');
    const source = document.querySelector('input[name="source"]:checked');
    return {
      csrf: bootstrap?.csrf || '',
      customerName: nameInput instanceof HTMLInputElement ? nameInput.value.trim() : '',
      phone: phoneInput instanceof HTMLInputElement ? phoneInput.value.trim() : '',
      address: addressValue instanceof HTMLInputElement ? addressValue.value : '',
      note: document.querySelector('[data-note]') instanceof HTMLInputElement ? document.querySelector('[data-note]').value.trim() : '',
          lines: cart.map((line, index) => ({
        slot: String(index),
        productId: String(line.productId || ''),
        weight: line.weight,
        quantity: String(line.quantity),
        price: String(line.unitPrice),
        name: line.name,
        note: line.note,
      })),
      discountCode: discountCode instanceof HTMLSelectElement ? discountCode.value : '',
      discountExtra: discountExtra instanceof HTMLInputElement ? discountExtra.value : '',
      orderTotal: orderTotal instanceof HTMLInputElement ? orderTotal.value : '',
      payState: pay instanceof HTMLInputElement ? pay.value : 'cod',
      source: source instanceof HTMLInputElement ? source.value : '',
      priority: priorityEl instanceof HTMLInputElement && priorityEl.checked,
      compensation: compensationEl instanceof HTMLInputElement && compensationEl.checked,
      shipLater: shipLaterEl instanceof HTMLInputElement && shipLaterEl.checked,
      shipOn: shipOnEl instanceof HTMLInputElement ? shipOnEl.value : '',
      shippingFee: shipFeeEl instanceof HTMLInputElement ? shipFeeEl.value : '',
      freeShip: freeShipEl instanceof HTMLInputElement && freeShipEl.checked,
      depositAmount: depositAmount instanceof HTMLInputElement ? depositAmount.value : '',
    };
  }

  function validateDraft(draft) {
    if (!draft.customerName) return { el: nameInput, msg: 'Nhập họ tên khách.' };
    if (!draft.phone) return { el: phoneInput, msg: 'Nhập số điện thoại.' };
    if (!isValidOrderPhone(draft.phone)) {
      return { el: phoneInput, msg: 'Số điện thoại không hợp lệ (cần SĐT Việt Nam 10 số).' };
    }
    if (!addressSelection.provinceCode) {
      return { el: provinceCombo ? comboParts(provinceCombo).trigger : provinceCombo, msg: 'Chọn tỉnh / thành phố.' };
    }
    if (!addressSelection.wardCode) {
      return { el: wardCombo ? comboParts(wardCombo).trigger : wardCombo, msg: 'Chọn phường / xã.' };
    }
    if (!(lineInput instanceof HTMLInputElement && lineInput.value.trim())) {
      return { el: lineInput, msg: 'Nhập số nhà, đường.' };
    }
    if (!draft.address) return { el: lineInput, msg: 'Địa chỉ chưa hợp lệ.' };
    if (!draft.lines.length) return { el: cartEmpty, msg: 'Thêm ít nhất một sản phẩm.' };
    for (const line of cart) {
      const product = products.find((item) => Number(item.id) === Number(line.productId));
      if (product && needsWeight(product) && !String(line.weight || '').trim()) {
        return { el: cartEl, msg: `Chọn cân nặng / size cho «${line.name || 'sản phẩm'}».` };
      }
      if (!(Number(line.quantity) > 0)) {
        return { el: cartEl, msg: 'Số lượng sản phẩm phải lớn hơn 0.' };
      }
    }
    if (!draft.payState) return { el: payStatesEl, msg: 'Chọn hình thức thanh toán.' };
    if (!draft.source) return { el: sourcesEl, msg: 'Chọn nguồn khách.' };
    if (draft.payState === 'deposit' && !moneyOf(draft.depositAmount)) {
      return { el: depositAmount, msg: 'Nhập số tiền cọc.' };
    }
    if (draft.shipLater && !draft.shipOn) return { el: shipOnEl, msg: 'Chọn ngày dự kiến gửi.' };
    return null;
  }

  async function ensureAddressRows() {
    if (addressRows.length) return;
    await loadAddressRows();
  }

  async function applyBootstrapPayload(data, { quiet = false } = {}) {
    bootstrap = data;
    try {
      await ensureAddressRows();
      fillProvinces(addressSelection.provinceCode, addressSelection.wardCode);
    } catch {
      if (!quiet) {
        setBoot('Không tải được danh sách địa chỉ. Tải lại extension.');
        show(authBox, true);
        show(form, false);
      }
      return false;
    }
    initCatalog(data);
    setBoot('');
    show(authBox, false);
    show(form, true);
    return true;
  }

  async function loadBootstrap() {
    setFormError('');
    show(authBox, false);

    // Song song: địa chỉ local + peek cache + fetch mạng (không chờ tuần tự).
    const addressPromise = ensureAddressRows().catch((error) => error);
    const peekPromise = send('vdt-pos-bootstrap-peek');
    const freshPromise = send('vdt-pos-bootstrap');

    const cached = await peekPromise;
    let painted = false;
    if (cached?.ok) {
      const addressError = await addressPromise;
      if (!(addressError instanceof Error)) {
        painted = await applyBootstrapPayload(cached, { quiet: true });
        if (painted) notifyReady();
      }
    }

    if (!painted) {
      setBoot('Đang tải dữ liệu đơn…');
      show(form, false);
    }

    const data = await freshPromise;
    if (data?.error === 'auth' || (!data?.ok && data?.error === 'auth')) {
      setBoot('');
      if (authText instanceof HTMLElement) {
        authText.textContent = 'Chưa đăng nhập admin. Đăng nhập trên trang quản trị một lần — sidebar dùng chung phiên.';
      }
      show(authBox, true);
      show(form, false);
      notifyReady();
      return;
    }
    if (!data?.ok) {
      if (!painted) {
        setBoot(data?.error || 'Không tải được dữ liệu. Thử lại.');
        show(authBox, true);
        show(form, false);
      }
      notifyReady();
      return;
    }

    const addressError = await addressPromise;
    if (addressError instanceof Error) {
      if (!painted) {
        setBoot('Không tải được danh sách địa chỉ. Tải lại extension.');
        show(authBox, true);
        show(form, false);
      }
      notifyReady();
      return;
    }

    await applyBootstrapPayload(data);
    notifyReady();
    // Mapping địa chỉ cũ ~1MB — chỉ nạp sau khi form đã hiện.
    void send('vdt-legacy-warmup');
  }

  document.querySelector('[data-login]')?.addEventListener('click', () => void send('vdt-open-login'));
  document.querySelector('[data-retry]')?.addEventListener('click', () => void loadBootstrap());
  lookupRun?.addEventListener('click', () => void runLookup());
  lookupInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void runLookup();
    }
  });

  bindAddress();
  bindLegacy();
  bindProducts();
  bindMeta();

  function requestSendConfirm(messages) {
    return new Promise((resolve) => {
      if (confirmWaiter) {
        confirmWaiter.resolve({ ok: false, error: 'Đang có lần gửi xác nhận khác.' });
        confirmWaiter = null;
      }
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        confirmWaiter = null;
        resolve({ ok: false, error: 'Hết thời gian chờ gửi tin xác nhận.' });
      }, 20000);
      confirmWaiter = {
        resolve: (value) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          confirmWaiter = null;
          resolve(value);
        },
      };
      try {
        window.parent.postMessage({ source: 'vdt-pos', type: 'vdt-send-confirm', messages }, '*');
      } catch {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        confirmWaiter = null;
        resolve({ ok: false, error: 'Không gửi được tin xác nhận.' });
      }
    });
  }

  function setConfirmButtonsBusy(busy, labelConfirm = 'Gửi xác nhận', labelCombo = 'Gửi xác nhận + tạo đơn') {
    if (sendConfirmBtn instanceof HTMLButtonElement) {
      sendConfirmBtn.disabled = busy;
      setButtonLabel(sendConfirmBtn, busy ? 'Đang gửi…' : labelConfirm);
    }
    if (sendConfirmCreateBtn instanceof HTMLButtonElement) {
      sendConfirmCreateBtn.disabled = busy;
      setButtonLabel(sendConfirmCreateBtn, busy ? 'Đang xử lý…' : labelCombo);
    }
  }

  /**
   * @param {object} draft
   * @returns {Promise<{ ok: boolean, auth?: boolean, result?: object, error?: string }>}
   */
  async function createOrUpdateOrder(draft) {
    if (!draft.csrf && bootstrap?.csrf) draft.csrf = bootstrap.csrf;
    const editing = isEditing();
    const result = editing
      ? await send('vdt-pos-order-update', { orderId: editingOrderId, payload: draft })
      : await send('vdt-pos-create', { payload: draft });
    if (result?.error === 'auth' || (!result?.ok && result?.error === 'auth')) {
      return { ok: false, auth: true };
    }
    if (!result?.ok || typeof result.id !== 'number') {
      return { ok: false, result };
    }
    const phone = draft.phone;
    await showSaved(result, { updated: editing });
    if (editing) {
      clearEditMode({ resetForm: true });
      try {
        window.parent.postMessage({ source: 'vdt-pos', type: 'vdt-order-updated', phone }, '*');
      } catch {
        /* ignore */
      }
    } else {
      resetAfterCreate();
    }
    return { ok: true, result };
  }

  if (form instanceof HTMLFormElement) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (submitting || sendingConfirm) return;
      const draft = requireDraftReady();
      if (!draft) return;
      submitting = true;
      setSubmitBusy(true);
      void (async () => {
        try {
          const outcome = await createOrUpdateOrder(draft);
          if (outcome.auth) {
            show(form, false);
            show(authBox, true);
            if (authText instanceof HTMLElement) {
              authText.textContent = 'Phiên đăng nhập hết hạn. Đăng nhập lại rồi bấm tải lại.';
            }
            setFormError(isEditing() ? 'Cần đăng nhập admin để sửa đơn.' : 'Cần đăng nhập admin để tạo đơn.');
            return;
          }
          if (!outcome.ok) {
            const mapped = mapCreateError(outcome.result);
            revealInvalid(mapped);
            if (/phiên không hợp lệ/i.test(mapped.msg)) void loadBootstrap();
            return;
          }
          setFormError('');
        } catch {
          setFormError('Không kết nối được. Thử lại.');
        } finally {
          submitting = false;
          setSubmitBusy(false);
        }
      })();
    });
  }

  editCancel?.addEventListener('click', () => {
    if (submitting) return;
    clearEditMode({ resetForm: true });
    setFormError('');
  });

  sendConfirmBtn?.addEventListener('click', () => {
    if (sendingConfirm || submitting) return;
    const draft = requireDraftReady();
    if (!draft) return;
    const messages = buildConfirmMessages();
    sendingConfirm = true;
    setConfirmButtonsBusy(true);
    void requestSendConfirm(messages).then((result) => {
      sendingConfirm = false;
      setConfirmButtonsBusy(false);
      if (!result?.ok) setFormError(result?.error || 'Không gửi được tin xác nhận vào ô chat.');
      else setStatusMessage('Đã gửi tin xác nhận vào ô chat.');
    });
  });

  sendConfirmCreateBtn?.addEventListener('click', () => {
    if (sendingConfirm || submitting) return;
    const draft = requireDraftReady();
    if (!draft) return;
    const messages = buildConfirmMessages();
    sendingConfirm = true;
    submitting = true;
    setConfirmButtonsBusy(true);
    setSubmitBusy(true);
    void (async () => {
      try {
        const sent = await requestSendConfirm(messages);
        if (!sent?.ok) {
          setFormError(sent?.error || 'Không gửi được tin xác nhận vào ô chat.');
          return;
        }
        const outcome = await createOrUpdateOrder(draft);
        if (outcome.auth) {
          show(form, false);
          show(authBox, true);
          if (authText instanceof HTMLElement) {
            authText.textContent = 'Phiên đăng nhập hết hạn. Đăng nhập lại rồi bấm tải lại.';
          }
          setFormError('Cần đăng nhập admin để tạo đơn.');
          return;
        }
        if (!outcome.ok) {
          const mapped = mapCreateError(outcome.result);
          revealInvalid(mapped);
          if (/phiên không hợp lệ/i.test(mapped.msg)) void loadBootstrap();
          setFormError(mapped.msg || 'Đã gửi tin nhưng tạo đơn thất bại.');
          return;
        }
        setFormError('');
      } catch {
        setFormError('Không kết nối được. Thử lại.');
      } finally {
        sendingConfirm = false;
        submitting = false;
        setConfirmButtonsBusy(false);
        setSubmitBusy(false);
      }
    })();
  });

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.source !== 'vdt-ext') return;
    if (data.type === 'vdt-send-confirm-result') {
      if (confirmWaiter) {
        confirmWaiter.resolve({ ok: Boolean(data.ok), error: data.error || '' });
        confirmWaiter = null;
      }
      return;
    }
    if (data.type === 'vdt-ping') {
      notifyReady();
      return;
    }
    if (data.type === 'vdt-edit-order' && data.orderId != null) {
      void beginEditOrder(data.orderId);
      return;
    }
    if (data.type === 'vdt-duplicate-order' && data.orderId != null) {
      void beginDuplicateOrder(data.orderId);
      return;
    }
    if (data.type === 'vdt-fill-customer' || data.type === 'vdt-fill-phone') {
      if (typeof data.name === 'string' && nameInput instanceof HTMLInputElement && data.name.trim()) {
        nameInput.value = data.name.replace(/\s+/g, ' ').trim().slice(0, 80);
      }
      if (typeof data.phone === 'string' && data.phone.trim()) {
        if (phoneInput instanceof HTMLInputElement) phoneInput.value = data.phone.trim();
        if (lookupInput instanceof HTMLInputElement) lookupInput.value = data.phone.trim();
      }
      return;
    }
    if (data.type === 'vdt-fill-address') {
      if (typeof data.phone === 'string' && data.phone.trim()) {
        if (phoneInput instanceof HTMLInputElement) phoneInput.value = data.phone.trim();
        if (lookupInput instanceof HTMLInputElement) lookupInput.value = data.phone.trim();
      }
      const hasCodes =
        typeof data.provinceCode === 'string' &&
        data.provinceCode &&
        typeof data.wardCode === 'string' &&
        data.wardCode;
      const mapOld = typeof data.oldText === 'string' ? data.oldText.trim() : '';
      const mapNew = typeof data.newText === 'string' ? data.newText.trim() : '';
      if (hasCodes) {
        applyAddress({
          provinceCode: data.provinceCode,
          wardCode: data.wardCode,
          line: typeof data.line === 'string' ? data.line : '',
          keepLine: data.keepLine === true || (typeof data.line === 'string' && data.line.length === 0),
        });
        if (!data.needPick) {
          // Khớp rõ: hiện banner cũ→mới để nhân viên tự tin; xóa list chọn.
          legacyItems = [];
          if (legacyInput instanceof HTMLInputElement) legacyInput.value = '';
          closeLegacyList();
          if (mapNew) {
            showAddressMap({ oldText: mapOld, newText: mapNew });
            setLegacyHint(
              mapOld
                ? `Đã map theo bảng 2025: ${mapOld} → ${mapNew}`
                : `Đã điền ${mapNew}`,
            );
          } else {
            clearAddressMap();
            setLegacyHint(data.matched === false ? 'Đã điền xã/tỉnh — kiểm tra lại số nhà nếu cần.' : '');
          }
          const addressCard = document.querySelector('[data-section="customer"]') || addressRoot;
          if (addressCard instanceof HTMLElement) {
            addressCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            addressCard.classList.add('is-block-attention');
            window.setTimeout(() => addressCard.classList.remove('is-block-attention'), 1600);
          }
          return;
        }
      } else if (typeof data.address === 'string' && data.address.trim()) {
        // Không có mã tỉnh/xã: tránh giữ địa chỉ cũ khi đang cần chọn tay.
        if (data.needPick) {
          fillProvinces();
          if (lineInput instanceof HTMLInputElement) {
            lineInput.value = String(data.line || data.address).replace(/\s+/g, ' ').trim().slice(0, 80);
          }
          writeAddress();
          clearAddressMap();
        } else {
          applyComposedAddress(data.address);
          legacyItems = [];
          if (legacyInput instanceof HTMLInputElement) legacyInput.value = '';
          closeLegacyList();
          clearAddressMap();
        }
      }

      // Nhiều kết quả / chưa khớp rõ: hiện list để đổi (sau khi đã điền tạm nếu có).
      if (data.needPick) {
        const query =
          typeof data.legacyQuery === 'string' && data.legacyQuery.trim()
            ? data.legacyQuery.trim()
            : typeof data.address === 'string'
              ? data.address.trim()
              : '';
        if (legacyInput instanceof HTMLInputElement && query) {
          legacyInput.value = query.slice(0, 160);
          if (Array.isArray(data.legacyItems) && data.legacyItems.length) {
            legacyItems = data.legacyItems;
            legacyActive = 0;
            renderLegacyList();
            const first = legacyItems[0];
            const firstLabel = first?.newText ? String(first.newText) : '';
            const firstOld = first?.oldText ? String(first.oldText) : '';
            if (hasCodes && firstLabel) {
              showAddressMap({ oldText: firstOld || mapOld, newText: firstLabel });
            } else {
              clearAddressMap();
            }
            setLegacyHint(
              hasCodes && firstLabel
                ? `Đã chọn tạm ${firstLabel} — bấm kết quả khác nếu sai.`
                : `Chọn 1 trong ${legacyItems.length} kết quả gần đúng.`,
            );
          } else {
            clearAddressMap();
            void runLegacySearch(query);
            setLegacyHint('Chưa khớp tự động — tìm/chọn địa chỉ cũ, hoặc chọn tỉnh–xã bên dưới.');
          }
        } else {
          clearAddressMap();
          setLegacyHint('Chưa khớp tự động — chọn tỉnh/xã thủ công hoặc dùng tìm địa chỉ cũ.');
        }
        const addressCard = document.querySelector('[data-section="customer"]') || legacyRoot;
        if (addressCard instanceof HTMLElement) {
          addressCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
          addressCard.classList.add('is-block-attention');
          window.setTimeout(() => addressCard.classList.remove('is-block-attention'), 1800);
        }
        if (legacyInput instanceof HTMLInputElement) {
          try {
            legacyInput.focus({ preventScroll: true });
          } catch {
            legacyInput.focus();
          }
        }
      }
    }
  });

  addressMapClose?.addEventListener('click', () => clearAddressMap());

  void loadBootstrap();
})();
