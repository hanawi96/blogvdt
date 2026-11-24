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
  const editSwitchModal = document.querySelector('[data-edit-switch]');
  const editSwitchStayBtns = document.querySelectorAll('[data-edit-switch-stay]');
  const editSwitchLeaveBtn = document.querySelector('[data-edit-switch-leave]');
  /** @type {null | { key: string, channel: string, chatId: string, name: string, phone: string }} */
  let pendingEditSwitch = null;
  /** Chat user đã chọn «Tiếp tục sửa» — bỏ qua fill tới khi hủy/lưu sửa hoặc đổi chat khác. */
  let editSwitchIgnoredKey = '';
  /** @type {null | { key: string, channel: string, chatId: string, name: string, phone: string }} */
  let editSwitchIgnoredFill = null;

  const nameInput = document.querySelector('[data-customer-name]');
  const phoneInput = document.querySelector('[data-customer-phone]');

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
  /** Kênh host: zalo | pancake | '' */
  let hostChannel = '';
  /** Chat đang mở trên host — đổi chat thì ẩn banner tạo đơn. */
  let hostChatId = '';
  /** Timer ẩn banner thành công (tạo/lưu đơn). */
  let savedHideTimer = 0;
  /** Draft POS theo chat — chrome.storage.local. */
  const POS_DRAFTS_KEY = 'posDrafts';
  const POS_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const POS_DRAFT_MAX = 50;
  const POS_DRAFT_SAVE_MS = 400;
  const POS_DRAFT_PROTECT_MS = 4000;
  let draftSaveTimer = 0;
  let draftRestoredAt = 0;
  let suppressDraftSave = false;
  /** Giá trị nguồn vừa auto-gán — không đè nếu nhân viên đã đổi tay. */
  let autoSource = '';
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
  /** @type {Array<{key: string, productId: number, name: string, weight: string, quantity: number, note: string, unitPrice: number, categorySlug: string, coverUrl?: string, custom?: boolean, unitCost?: number}>} */
  let cart = [];
  let defaultShipFee = '';
  /** @type {null | { product: object, editIndex: number | null, weight: string, qty: number, note: string, name: string, price: string, unitCost: string, extraOpen: boolean }} */
  let customDraft = null;
  /** Đơn đang hiện trên card khách — «Gửi xác nhận» khi form trống lấy từ đây. */
  /** @type {number | null} */
  let activeHostOrderId = null;
  /** @type {string} */
  let activeHostOrderPhone = '';
  /** @type {null | { resolve: (id: number | null) => void }} */
  let activeOrderWaiter = null;

  function confirmPhoneKey(raw) {
    return normalizeOrderPhone(raw) || String(raw || '').trim();
  }

  function show(el, on) {
    if (el instanceof HTMLElement) el.hidden = !on;
    if (el === authBox) document.body.classList.toggle('is-auth', Boolean(on));
  }

  function setBoot(text) {
    if (bootStatus instanceof HTMLElement) {
      bootStatus.textContent = text;
      bootStatus.hidden = !text;
    }
  }

  function clearSavedBanner() {
    window.clearTimeout(savedHideTimer);
    savedHideTimer = 0;
    if (!(savedEl instanceof HTMLElement)) return;
    savedEl.hidden = true;
    savedEl.textContent = '';
  }

  function scheduleHideSaved(ms = 2000) {
    window.clearTimeout(savedHideTimer);
    savedHideTimer = window.setTimeout(() => {
      savedHideTimer = 0;
      if (savedEl instanceof HTMLElement) {
        savedEl.hidden = true;
        savedEl.textContent = '';
      }
    }, ms);
  }

  function setFormError(text) {
    const msg = String(text || '').trim();
    if (formError instanceof HTMLElement) {
      formError.hidden = !msg;
      formError.textContent = msg;
    }
    // Có lỗi → ẩn banner thành công cũ để không chồng 2–3 thông báo.
    if (msg) clearSavedBanner();
  }

  /** Chuẩn hóa/kiểm tra mobile VN — khớp content.js / order.ts. */
  function normalizeOrderPhone(raw) {
    let digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return null;
    if (digits.startsWith('84') && digits.length >= 11) digits = digits.slice(2);
    const bodyOk = /^(?:3[2-9]|5[2689]|7[06-9]|8[1-9]|9\d)\d{7}$/;
    if (digits.length === 9 && bodyOk.test(digits)) digits = `0${digits}`;
    if (digits.length === 10 && digits.startsWith('0') && bodyOk.test(digits.slice(1))) return digits;
    return null;
  }

  function isValidOrderPhone(raw) {
    return Boolean(normalizeOrderPhone(raw));
  }

  function draftStorageKey(channel, chatId) {
    const ch = String(channel || '').trim();
    const id = String(chatId || '').trim();
    if (!ch || !id) return '';
    return `${ch}:${id}`;
  }

  function draftProtectActive() {
    return Date.now() - draftRestoredAt < POS_DRAFT_PROTECT_MS;
  }

  async function readDraftMap() {
    try {
      const stored = await chrome.storage.local.get([POS_DRAFTS_KEY]);
      const map = stored?.[POS_DRAFTS_KEY];
      return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
    } catch {
      return {};
    }
  }

  async function writeDraftMap(map) {
    try {
      await chrome.storage.local.set({ [POS_DRAFTS_KEY]: map });
    } catch {
      /* quota / extension reload */
    }
  }

  function pruneDraftMap(map, now = Date.now()) {
    /** @type {Array<[string, object]>} */
    const entries = Object.entries(map || {}).filter(([, draft]) => {
      if (!draft || typeof draft !== 'object') return false;
      const updatedAt = Number(draft.updatedAt) || 0;
      return now - updatedAt <= POS_DRAFT_TTL_MS;
    });
    entries.sort((a, b) => (Number(b[1].updatedAt) || 0) - (Number(a[1].updatedAt) || 0));
    const next = {};
    for (const [key, draft] of entries.slice(0, POS_DRAFT_MAX)) next[key] = draft;
    return next;
  }

  function buildDraftPayload() {
    writeAddress();
    const pay = document.querySelector('input[name="payState"]:checked');
    const source = document.querySelector('input[name="source"]:checked');
    const noteEl = document.querySelector('[data-note]');
    return {
      channel: hostChannel,
      chatId: hostChatId,
      updatedAt: Date.now(),
      customerName: nameInput instanceof HTMLInputElement ? nameInput.value.trim() : '',
      phone: phoneInput instanceof HTMLInputElement ? phoneInput.value.trim() : '',
      note: noteEl instanceof HTMLInputElement ? noteEl.value.trim() : '',
      addressSelection: {
        provinceCode: addressSelection.provinceCode || '',
        wardCode: addressSelection.wardCode || '',
      },
      line: lineInput instanceof HTMLInputElement ? lineInput.value.trim() : '',
      cart: cart.map((line) => ({
        productId: Number(line.productId) || 0,
        name: String(line.name || ''),
        weight: String(line.weight || ''),
        quantity: Number(line.quantity) || 1,
        note: String(line.note || ''),
        unitPrice: Number(line.unitPrice) || 0,
        coverUrl: String(line.coverUrl || ''),
        categorySlug: String(line.categorySlug || ''),
        custom: Boolean(line.custom),
        unitCost: line.custom ? Math.max(0, Number(line.unitCost) || 0) : undefined,
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

  function draftWorthSaving(payload) {
    if (!payload) return false;
    // Chỉ lưu khi có nội dung đơn — tên/SĐT host fill không đủ để giữ draft.
    if (Array.isArray(payload.cart) && payload.cart.length > 0) return true;
    if (String(payload.line || '').trim()) return true;
    if (payload.addressSelection?.provinceCode) return true;
    if (String(payload.note || '').trim()) return true;
    if (String(payload.orderTotal || '').replace(/\D/g, '')) return true;
    if (String(payload.discountCode || '').trim() || String(payload.discountExtra || '').replace(/\D/g, '')) return true;
    if (payload.priority || payload.compensation || payload.shipLater || payload.freeShip) return true;
    return false;
  }

  async function saveCurrentDraft({ force = false } = {}) {
    if (suppressDraftSave && !force) return;
    if (isEditing()) return;
    const key = draftStorageKey(hostChannel, hostChatId);
    if (!key) return;
    const payload = buildDraftPayload();
    const map = pruneDraftMap(await readDraftMap());
    if (!draftWorthSaving(payload)) {
      if (map[key]) {
        delete map[key];
        await writeDraftMap(map);
      }
      return;
    }
    map[key] = payload;
    await writeDraftMap(pruneDraftMap(map));
  }

  function scheduleDraftSave() {
    if (suppressDraftSave || isEditing()) return;
    if (!draftStorageKey(hostChannel, hostChatId)) return;
    window.clearTimeout(draftSaveTimer);
    draftSaveTimer = window.setTimeout(() => {
      draftSaveTimer = 0;
      void saveCurrentDraft();
    }, POS_DRAFT_SAVE_MS);
  }

  async function loadDraft(channel, chatId) {
    const key = draftStorageKey(channel, chatId);
    if (!key) return null;
    const map = pruneDraftMap(await readDraftMap());
    const draft = map[key];
    if (!draft || typeof draft !== 'object') return null;
    if (!draftWorthSaving(draft)) return null;
    return draft;
  }

  async function clearDraft(channel, chatId) {
    const key = draftStorageKey(channel, chatId);
    if (!key) return;
    window.clearTimeout(draftSaveTimer);
    draftSaveTimer = 0;
    const map = await readDraftMap();
    if (!map[key]) return;
    delete map[key];
    await writeDraftMap(map);
  }

  function resetFormForChatSwitch() {
    suppressDraftSave = true;
    try {
      cart = [];
      cartEdit = null;
      closePickPanel();
      if (nameInput instanceof HTMLInputElement) nameInput.value = '';
      if (phoneInput instanceof HTMLInputElement) phoneInput.value = '';
      if (lineInput instanceof HTMLInputElement) lineInput.value = '';
      addressSelection.provinceCode = '';
      addressSelection.wardCode = '';
      fillProvinces();
      writeAddress();
      clearAddressMap();
      const noteEl = document.querySelector('[data-note]');
      if (noteEl instanceof HTMLInputElement) noteEl.value = '';
      if (discountCode instanceof HTMLSelectElement) discountCode.value = '';
      if (discountExtra instanceof HTMLInputElement) discountExtra.value = '';
      if (orderTotal instanceof HTMLInputElement) {
        orderTotal.value = '';
        delete orderTotal.dataset.lock;
      }
      if (depositAmount instanceof HTMLInputElement) depositAmount.value = '';
      if (shipOnEl instanceof HTMLInputElement) shipOnEl.value = '';
      if (legacyInput instanceof HTMLInputElement) legacyInput.value = '';
      closeLegacyList();
      setLegacyHint('');
      setMetaFlags({
        payState: 'cod',
        source: sourceForChannel(hostChannel) || '',
        priority: false,
        compensation: false,
        shipLater: false,
        shipOn: '',
        freeShip: false,
        shippingFee: defaultShipFee || '',
        depositAmount: '',
      });
      if (sourceForChannel(hostChannel)) autoSource = sourceForChannel(hostChannel);
      renderCart();
      renderPickList();
      paintPay();
    } finally {
      suppressDraftSave = false;
    }
  }

  async function applyDraftToForm(draft) {
    if (!draft || typeof draft !== 'object') return;
    suppressDraftSave = true;
    try {
      await ensureAddressRows().catch(() => null);
      if (nameInput instanceof HTMLInputElement) nameInput.value = String(draft.customerName || '').slice(0, 80);
      if (phoneInput instanceof HTMLInputElement) phoneInput.value = String(draft.phone || '');
      const noteEl = document.querySelector('[data-note]');
      if (noteEl instanceof HTMLInputElement) noteEl.value = String(draft.note || '').slice(0, 500);
      const provinceCode = String(draft.addressSelection?.provinceCode || '');
      const wardCode = String(draft.addressSelection?.wardCode || '');
      const line = String(draft.line || '');
      if (provinceCode) {
        applyAddress({ provinceCode, wardCode, line, keepLine: false });
      } else {
        applyAddress({ provinceCode: '', wardCode: '', line, keepLine: false });
      }
      cart = (Array.isArray(draft.cart) ? draft.cart : []).map((lineItem, index) => {
        const productId = Number(lineItem.productId) || 0;
        const weight = String(lineItem.weight || '');
        const note = String(lineItem.note || '');
        const quantity = Math.max(1, Math.min(20, Number(lineItem.quantity) || 1));
        const unitPrice = Math.max(0, Number(lineItem.unitPrice) || 0);
        const custom = Boolean(lineItem.custom);
        const unitCost = custom ? Math.max(0, Number(lineItem.unitCost) || 0) : undefined;
        const catalog = products.find((item) => Number(item.id) === productId);
        const name = String(lineItem.name || catalog?.name || '');
        const priced = unitPrice || Number(catalog?.price) || 0;
        return {
          key: cartLineKey({ productId, weight, note, name, unitPrice: priced, unitCost, custom }, index),
          productId,
          name,
          weight,
          quantity,
          note,
          unitPrice: priced,
          coverUrl: String(lineItem.coverUrl || catalog?.coverUrl || ''),
          categorySlug: String(lineItem.categorySlug || catalog?.categorySlug || ''),
          ...(custom ? { custom: true, unitCost: unitCost ?? 0 } : {}),
        };
      });
      if (discountCode instanceof HTMLSelectElement) discountCode.value = String(draft.discountCode || '');
      if (discountExtra instanceof HTMLInputElement) discountExtra.value = String(draft.discountExtra || '');
      if (orderTotal instanceof HTMLInputElement) {
        orderTotal.value = String(draft.orderTotal || '');
        if (orderTotal.value) orderTotal.dataset.lock = '1';
        else delete orderTotal.dataset.lock;
      }
      setMetaFlags({
        payState: draft.payState || 'cod',
        source: draft.source || sourceForChannel(hostChannel) || '',
        priority: Boolean(draft.priority),
        compensation: Boolean(draft.compensation),
        shipLater: Boolean(draft.shipLater),
        shipOn: draft.shipOn || '',
        freeShip: Boolean(draft.freeShip),
        shippingFee: draft.shippingFee || '',
        depositAmount: draft.depositAmount || '',
      });
      closePickPanel();
      renderCart();
      renderPickList();
      paintPay();
      draftRestoredAt = Date.now();
    } finally {
      suppressDraftSave = false;
    }
  }

  /**
   * Đổi hội thoại: lưu draft cũ → khôi phục draft mới hoặc form trống + fill host.
   * @returns {Promise<boolean>} true nếu đã restore draft (fill chỉ nên đè field trống)
   */
  async function switchChatContext(channel, chatId) {
    const nextChannel = String(channel || hostChannel || '').trim();
    const nextChatId = String(chatId || '').trim();
    if (!nextChatId) return false;
    if (nextChatId === hostChatId && nextChannel === hostChannel) return draftProtectActive();

    // Đang sửa: không đổi context — cần xác nhận ở offerEditChatSwitch.
    if (isEditing()) return false;

    if (hostChatId) {
      window.clearTimeout(draftSaveTimer);
      draftSaveTimer = 0;
      await saveCurrentDraft({ force: true });
    }
    clearSavedBanner();
    // Không xóa snapshot tin xác nhận theo chatId — snapshot gắn SĐT (sessionStorage).
    hostChannel = nextChannel;
    hostChatId = nextChatId;

    const draft = await loadDraft(nextChannel, nextChatId);
    if (draft) {
      await applyDraftToForm(draft);
      return true;
    }
    resetFormForChatSwitch();
    applyChannelSource(nextChannel, { force: true });
    return false;
  }

  function hideEditSwitchConfirm() {
    pendingEditSwitch = null;
    show(editSwitchModal, false);
  }

  function offerEditChatSwitch(pending) {
    if (!pending?.key || !pending.chatId) return;
    if (pendingEditSwitch?.key === pending.key) {
      show(editSwitchModal, true);
      return;
    }
    pendingEditSwitch = {
      key: pending.key,
      channel: String(pending.channel || ''),
      chatId: String(pending.chatId || ''),
      name: String(pending.name || ''),
      phone: String(pending.phone || ''),
    };
    show(editSwitchModal, true);
  }

  async function applyFillAfterChatSwitch(payload, restored) {
    const protect = restored || draftProtectActive();
    if (typeof payload.name === 'string' && payload.name.trim() && nameInput instanceof HTMLInputElement) {
      if (!protect || !nameInput.value.trim()) {
        nameInput.value = payload.name.replace(/\s+/g, ' ').trim().slice(0, 80);
      }
    }
    if (typeof payload.phone === 'string' && payload.phone.trim() && phoneInput instanceof HTMLInputElement) {
      if (!protect || !phoneInput.value.trim()) {
        phoneInput.value = payload.phone.trim();
      }
    }
    if (typeof payload.channel === 'string') applyChannelSource(payload.channel);
    if (!restored) scheduleDraftSave();
  }

  async function confirmLeaveEditForChat() {
    const pending = pendingEditSwitch;
    editSwitchIgnoredKey = '';
    editSwitchIgnoredFill = null;
    hideEditSwitchConfirm();
    if (!pending?.chatId) return;
    // clearEditMode không catch-up vì ignored đã xóa — tự chuyển sang chat đã chọn.
    editingOrderId = null;
    editingOrderCode = '';
    paintEditMode();
    resetAfterCreate();
    const restored = await switchChatContext(pending.channel, pending.chatId);
    await applyFillAfterChatSwitch(pending, restored);
  }

  function stayInEditAgainstChatSwitch() {
    if (pendingEditSwitch) {
      editSwitchIgnoredKey = pendingEditSwitch.key;
      editSwitchIgnoredFill = { ...pendingEditSwitch };
    }
    hideEditSwitchConfirm();
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
    window.clearTimeout(savedHideTimer);
    savedHideTimer = 0;
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
      target.closest('.meta-block, .card, .block, .ship-row, .pick-card, .flag-chips, .discount') || target;
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
    const catchUp = editSwitchIgnoredFill;
    editingOrderId = null;
    editingOrderCode = '';
    editSwitchIgnoredKey = '';
    editSwitchIgnoredFill = null;
    hideEditSwitchConfirm();
    paintEditMode();
    if (resetForm) resetAfterCreate();
    // Host đã sang chat khác lúc đang sửa — sau khi thoát sửa thì bắt kịp fill đã bỏ qua.
    if (catchUp?.chatId) {
      void (async () => {
        const restored = await switchChatContext(catchUp.channel, catchUp.chatId);
        await applyFillAfterChatSwitch(catchUp, restored);
      })();
    }
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

  function scrollPanelToTop() {
    const run = () => {
      window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      const panel = document.getElementById('panel');
      if (panel instanceof HTMLElement) panel.scrollTop = 0;
    };
    requestAnimationFrame(() => {
      run();
      // Layout sau reset form có thể lệch — chốt lại một nhịp.
      window.setTimeout(run, 80);
    });
  }

  async function showSaved(result, { updated = false } = {}) {
    if (!(savedEl instanceof HTMLElement)) return;
    const origin = await adminOrigin();
    const code = result.code || `#${result.id}`;
    const total = result.total ? ` · ${result.total}` : '';
    const path = typeof result.url === 'string' ? result.url : `/admin/orders/${result.id}`;
    const href = path.startsWith('http') ? path : `${origin}${path.startsWith('/') ? '' : '/'}${path}`;
    window.clearTimeout(savedHideTimer);
    savedHideTimer = 0;
    savedEl.hidden = false;
    savedEl.innerHTML = '';
    savedEl.append(updated ? 'Đã lưu đơn ' : 'Đã tạo đơn ');
    const link = document.createElement('a');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = code;
    savedEl.append(link, updated ? `${total}.` : `${total}. Tiếp tục đơn mới bên dưới.`);
    scheduleHideSaved(2000);
  }

  function sourceForChannel(channel) {
    if (channel === 'zalo') return 'zalo';
    if (channel === 'pancake') return 'facebook';
    return '';
  }

  /** Zalo → Zalo, Pancake → Facebook; kênh khác / không biết → bỏ chọn. */
  function applyChannelSource(channel, { force = false } = {}) {
    if (isEditing() && !force) return;
    hostChannel = String(channel || '');
    const want = sourceForChannel(hostChannel);
    const radios = [...document.querySelectorAll('input[name="source"]')].filter(
      (input) => input instanceof HTMLInputElement,
    );
    if (!radios.length) return;
    const current = radios.find((input) => input.checked)?.value || '';
    if (!force && current && current !== autoSource) return;
    for (const input of radios) {
      input.checked = Boolean(want) && input.value === want;
    }
    autoSource = want;
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
    autoSource = '';
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
      if (orderTotal.value) orderTotal.dataset.lock = '1';
      else delete orderTotal.dataset.lock;
    }
    setMetaFlags(order.flags);
    paintPay();
    clearSavedBanner();
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
    editSwitchIgnoredKey = '';
    editSwitchIgnoredFill = null;
    hideEditSwitchConfirm();
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
    window.clearTimeout(savedHideTimer);
    savedHideTimer = 0;
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

  /** Extension không hiện chip «Chưa sinh». */
  function uiWeightChips(chips) {
    return (Array.isArray(chips) ? chips : []).filter((label) => label !== 'Chưa sinh');
  }

  function needsWeight(product) {
    const scale = scaleOf(product);
    return uiWeightChips(scale.chips).length + (scale.extras?.length || 0) > 0;
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

  function productInCategory(product, categoryKey) {
    const ids = Array.isArray(product?.categoryIds) ? product.categoryIds : [];
    if (ids.some((id) => String(id) === categoryKey)) return true;
    // Bootstrap cũ chỉ có categoryId chính.
    return String(product?.categoryId ?? '') === categoryKey;
  }

  function filteredProducts() {
    const needle = fold(pickText);
    let list = products.slice();
    if (pickCategory === 'hot') list = list.slice(0, 10);
    else if (pickCategory !== 'all') list = list.filter((item) => productInCategory(item, pickCategory));
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
    const chips = uiWeightChips(scaleOf(pendingProduct).chips);
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
    const chips = uiWeightChips(scale.chips);
    const extras = scale.extras || [];
    const noteQtyRow = `<div class="pick-panel-top">
      <div class="qty-box qty-box-compact">
        <button type="button" class="qty-btn" data-weight-qty-dec aria-label="Giảm số lượng">−</button>
        <input class="qty-value" type="text" inputmode="numeric" maxlength="2" value="${pendingQty}" data-weight-qty aria-label="Số lượng" />
        <button type="button" class="qty-btn" data-weight-qty-inc aria-label="Tăng số lượng">+</button>
      </div>
      <input class="field pick-note" maxlength="160" placeholder="Lưu ý sản phẩm…" data-weight-note value="${escapeHtml(pendingNote)}" />
    </div>`;
    const weightBlock = weigh
      ? `${noteQtyRow}
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
      : noteQtyRow;

    return `<div class="pick-panel" data-pick-panel>
      ${weightBlock}
      <div class="pick-panel-actions">
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
          <div class="pick-row">
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
            </button>
            <div class="pick-actions">
              <button type="button" class="pick-action" data-pick-toggle="${product.id}" aria-expanded="${open ? 'true' : 'false'}" title="${open ? 'Thu gọn' : 'Chọn cân / số lượng'}" aria-label="${open ? 'Thu gọn' : 'Chọn cân / số lượng'}">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
              </button>
              <button type="button" class="pick-action" data-pick-custom="${product.id}" title="Tùy chỉnh từ mẫu này" aria-label="Tùy chỉnh từ mẫu này">
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>
            </div>
          </div>
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

  function cartLineKey(line, index = 0) {
    if (line.custom) {
      return `custom|${line.productId || index}|${line.weight || ''}|${line.note || ''}|${line.name || ''}|${line.unitPrice || 0}|${line.unitCost ?? ''}`;
    }
    return `${line.productId || index}|${line.weight || ''}|${line.note || ''}`;
  }

  function addToCart(product, weight, quantity, note) {
    const unitPrice = applyWeightPrice(product.price, weight);
    const key = cartLineKey({ productId: product.id, weight, note });
    const existing = cart.find((line) => line.key === key && !line.custom);
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
    unlockOrderTotal();
    renderCart();
    paintPay();
    scheduleDraftSave();
  }

  function addCustomToCart(product, values, editIndex = null) {
    const line = {
      productId: product.id,
      name: values.name,
      weight: values.weight,
      quantity: values.quantity,
      note: values.note,
      unitPrice: values.unitPrice,
      unitCost: values.unitCost,
      custom: true,
      categorySlug: product.categorySlug || '',
      coverUrl: product.coverUrl || '',
      key: '',
    };
    line.key = cartLineKey(line);
    if (Number.isInteger(editIndex) && editIndex !== null && editIndex >= 0 && editIndex < cart.length) {
      cart[editIndex] = { ...cart[editIndex], ...line, coverUrl: cart[editIndex].coverUrl || line.coverUrl };
    } else {
      cart.push(line);
    }
    unlockOrderTotal();
    renderCart();
    paintPay();
    scheduleDraftSave();
  }

  /** @type {{ index: number, field: 'qty' | 'note' | 'weight', extraOpen?: boolean } | null} */
  let cartEdit = null;

  function cartLineProduct(line) {
    return products.find((item) => Number(item.id) === Number(line?.productId)) || null;
  }

  function focusCartEdit() {
    if (!cartEdit || !(cartEl instanceof HTMLElement)) return;
    if (cartEdit.field !== 'qty' && cartEdit.field !== 'note') return;
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

  function renderCartWeightEditor(line, product) {
    const scale = scaleOf(product);
    const allChips = Array.isArray(scale.chips) ? scale.chips : [];
    const chips = uiWeightChips(allChips);
    const extras = scale.extras || [];
    const weight = String(line.weight || '').trim();
    const extraOpen = Boolean(cartEdit?.extraOpen) || (weight && extras.includes(weight) && !allChips.includes(weight));
    return `<div class="cart-weight-editor" data-cart-weight-editor>
      <div class="chips pick-chips">
        ${chips
          .map(
            (label) =>
              `<button type="button" class="chip" data-cart-weight-chip="${escapeHtml(label)}" aria-pressed="${label === weight}">${escapeHtml(label)}</button>`,
          )
          .join('')}
        ${
          extras.length
            ? `<button type="button" class="chip weight-extra-toggle" data-cart-weight-extra-toggle aria-expanded="${extraOpen}" title="Cân nặng khác" aria-label="Cân nặng khác">+</button>`
            : ''
        }
      </div>
      ${
        extras.length
          ? `<label class="weight-extra-field" ${extraOpen ? '' : 'hidden'}>
              <span class="label">Cân nặng khác</span>
              <select class="field" data-cart-weight-extra>
                <option value="">Chọn…</option>
                ${extras
                  .map(
                    (label) =>
                      `<option value="${escapeHtml(label)}" ${label === weight ? 'selected' : ''}>${escapeHtml(label)}</option>`,
                  )
                  .join('')}
              </select>
            </label>`
          : ''
      }
    </div>`;
  }

  /** @param {{ keepEdit?: boolean }} [opts] */
  function renderCart(opts = {}) {
    if (!(cartEl instanceof HTMLElement)) return;
    if (!opts.keepEdit) cartEdit = null;
    if (cartEdit && (cartEdit.index < 0 || cartEdit.index >= cart.length)) cartEdit = null;
    show(cartEmpty, cart.length === 0);
    cartEl.innerHTML = cart
      .map((line, index) => {
        const product = cartLineProduct(line);
        const weigh = Boolean(product && needsWeight(product));
        const editingQty = cartEdit?.index === index && cartEdit.field === 'qty';
        const editingNote = cartEdit?.index === index && cartEdit.field === 'note';
        const editingWeight = cartEdit?.index === index && cartEdit.field === 'weight';
        const noteText = String(line.note || '').trim();
        const priceBit = formatVnd(line.unitPrice);
        const weightLabel = String(line.weight || '').trim();
        const subHtml = weigh
          ? `<button type="button" class="cart-info cart-info-weight" data-cart-edit-weight title="Bấm để sửa cân nặng">${escapeHtml(weightLabel || 'Cân nặng')}</button><span class="cart-sub-sep"> · ${escapeHtml(priceBit)}</span>`
          : escapeHtml([weightLabel, priceBit].filter(Boolean).join(' · '));
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
              <div class="cart-name">
                <span>${escapeHtml(line.name)}</span>
                ${line.custom ? '<button type="button" class="cart-custom-badge" data-cart-edit-custom title="Sửa sản phẩm tùy chỉnh">Tùy chỉnh</button>' : ''}
              </div>
              <div class="cart-sub">${subHtml}</div>
            </div>
            <button type="button" class="cart-remove" data-cart-remove>Xóa</button>
          </div>
          ${editingWeight && product ? renderCartWeightEditor(line, product) : ''}
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
    if (field !== 'qty' && field !== 'note' && field !== 'weight') return;
    /** @type {{ index: number, field: 'qty' | 'note' | 'weight', extraOpen?: boolean }} */
    const next = { index, field, extraOpen: false };
    if (field === 'weight') {
      const line = cart[index];
      const product = cartLineProduct(line);
      if (!product || !needsWeight(product)) return;
      const scale = scaleOf(product);
      const chips = scale.chips || [];
      const extras = scale.extras || [];
      const weight = String(line.weight || '').trim();
      if (weight && extras.includes(weight) && !chips.includes(weight)) next.extraOpen = true;
    }
    cartEdit = next;
    renderCart({ keepEdit: true });
  }

  function applyCartWeight(index, weight) {
    const line = cart[index];
    if (!line) return false;
    const product = cartLineProduct(line);
    if (!product || !needsWeight(product)) return false;
    const next = String(weight || '').trim();
    line.weight = next;
    if (!line.custom) line.unitPrice = applyWeightPrice(product.price, next);
    line.key = cartLineKey(line);
    return true;
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
    line.key = cartLineKey(line);
  }

  function endCartEdit(opts = {}) {
    cartEdit = null;
    unlockOrderTotal();
    renderCart();
    if (opts.paint !== false) paintPay();
    scheduleDraftSave();
  }

  function cartSubtotal() {
    return cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  }

  function unlockOrderTotal() {
    if (orderTotal instanceof HTMLInputElement) delete orderTotal.dataset.lock;
  }

  function selectedDiscount() {
    if (!(discountCode instanceof HTMLSelectElement) || !discountCode.value || !bootstrap) return null;
    return (bootstrap.discountChoices || []).find((item) => item.code === discountCode.value) || null;
  }

  /** @param {{ syncFreeShip?: boolean }} [opts] syncFreeShip=false khi user tự tick/bỏ miễn ship. */
  function computePayState(opts = {}) {
    const syncFreeShip = opts.syncFreeShip !== false;
    const subtotal = cartSubtotal();
    const codeAmount = quoteDiscount(selectedDiscount(), subtotal);
    const room = Math.max(0, subtotal - codeAmount);
    let extra = Math.min(room, moneyOf(discountExtra instanceof HTMLInputElement ? discountExtra.value : ''));
    const locked = orderTotal instanceof HTMLInputElement && orderTotal.dataset.lock === '1';
    // Giống admin: đổi giỏ thì tổng tự tính lại; chỉ giữ số gõ tay khi đang khóa.
    if (locked && orderTotal instanceof HTMLInputElement) {
      const shown = moneyOf(orderTotal.value);
      if (shown > subtotal) extra = 0;
      else extra = Math.max(0, room - shown);
    } else if (orderTotal instanceof HTMLInputElement) {
      orderTotal.value = room - extra > 0 ? groupDigits(String(room - extra), 9) : '';
    }
    if (
      discountExtra instanceof HTMLInputElement &&
      !(locked && orderTotal instanceof HTMLInputElement && moneyOf(orderTotal.value) > subtotal)
    ) {
      discountExtra.value = extra > 0 ? groupDigits(String(extra), 8) : '';
    }
    const goods = Math.max(0, room - extra);
    const shipLines = cart.map((line) => ({
      group: shipGroupOf(line.categorySlug),
      lineTotal: line.unitPrice * line.quantity,
    }));
    const autoFree = qualifiesFreeShip(shipLines);
    const compensation = compensationEl instanceof HTMLInputElement && compensationEl.checked;
    // Giống admin applyRule: đủ điều kiện → bật; hết đủ → tắt (kèm khôi phục phí mặc định bên dưới).
    if (syncFreeShip && freeShipEl instanceof HTMLInputElement && !compensation) {
      freeShipEl.checked = autoFree;
    }
    const free = (freeShipEl instanceof HTMLInputElement && freeShipEl.checked) || autoFree || compensation;
    if (shipFeeEl instanceof HTMLInputElement) {
      shipFeeEl.disabled = free;
      if (free) shipFeeEl.value = '';
      else if (!shipFeeEl.value && defaultShipFee) shipFeeEl.value = defaultShipFee;
    }
    const ship = free ? 0 : moneyOf(shipFeeEl instanceof HTMLInputElement ? shipFeeEl.value : '');
    const lockedTotal = locked && orderTotal instanceof HTMLInputElement ? moneyOf(orderTotal.value) : 0;
    const base = locked && lockedTotal > 0 ? lockedTotal : goods;
    const payable = compensation ? 0 : base + ship;
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

  /**
   * @param {{ name?: string, phone?: string, address?: string, note?: string, lines?: Array<{ name?: string, quantity?: string|number, weight?: string, note?: string }>, payValue?: string, payable?: number, ship?: number, free?: boolean }} parts
   */
  function formatConfirmMessages(parts) {
    const name = String(parts.name || '').trim();
    const phone = String(parts.phone || '').trim();
    const address = String(parts.address || '').trim();
    const orderNote = String(parts.note || '').trim();
    const payValue = parts.payValue || 'cod';
    const productLines = (Array.isArray(parts.lines) ? parts.lines : [])
      .map((line, index) => {
        const qty = Number(line.quantity) > 0 ? Number(line.quantity) : 1;
        const size = String(line.weight || '').trim();
        const lineNote = String(line.note || '').trim();
        const partsLine = [`${index + 1}. ${line.name || 'Sản phẩm'}`, `SL: ${qty} chiếc`];
        if (size) partsLine.push(`Size: ${size}`);
        if (lineNote) partsLine.push(`Lưu ý: ${lineNote}`);
        return partsLine.join('  ·  ');
      })
      .join('\n');
    const payable = Number(parts.payable) || 0;
    const ship = Number(parts.ship) || 0;
    const totalPart = parts.free
      ? `${compactVnd(payable)} (Miễn phí vận chuyển)`
      : ship > 0
        ? `${compactVnd(payable)} (gồm ship ${compactVnd(ship)})`
        : compactVnd(payable);
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
      ...(orderNote ? ['', `- Lưu ý đơn: ${orderNote}`] : []),
    ].join('\n');
    const msg2 = 'Phiền c kiểm tra và xác nhận thông tin giúp em với nha để em lưu đơn lại chị ha';
    return [msg1, msg2];
  }

  function buildConfirmMessages() {
    writeAddress();
    const name = nameInput instanceof HTMLInputElement ? nameInput.value.trim() : '';
    const phone = phoneInput instanceof HTMLInputElement ? phoneInput.value.trim() : '';
    const address = addressValue instanceof HTMLInputElement ? addressValue.value.trim() : '';
    const noteEl = document.querySelector('[data-note]');
    const note = noteEl instanceof HTMLInputElement ? noteEl.value.trim() : '';
    const payRadio = document.querySelector('input[name="payState"]:checked');
    const payValue = payRadio instanceof HTMLInputElement ? payRadio.value : 'cod';
    const payState = computePayState();
    return formatConfirmMessages({
      name,
      phone,
      address,
      note,
      lines: cart,
      payValue,
      payable: payState.payable,
      ship: payState.ship,
      free: payState.free,
    });
  }

  /** Dựng tin xác nhận từ đơn đã lưu (card khách / API pos-get). */
  function buildConfirmMessagesFromOrder(order) {
    const flags = order?.flags && typeof order.flags === 'object' ? order.flags : {};
    const free = Boolean(flags.freeShip || flags.compensation);
    const ship = free ? 0 : moneyOf(flags.shippingFee);
    const payable = Math.max(0, Number(order?.totalPrice) || 0);
    const lines = (Array.isArray(order?.lines) ? order.lines : []).map((line) => ({
      name: line.productName || line.name,
      quantity: line.quantity,
      weight: line.weight,
      note: line.note,
    }));
    return formatConfirmMessages({
      name: order?.customerName,
      phone: order?.phone,
      address: order?.address,
      note: order?.note,
      lines,
      payValue: flags.payState || 'cod',
      payable,
      ship,
      free,
    });
  }

  /** Tải đơn im lặng để gửi xác nhận — không đổ vào form. */
  async function fetchOrderForConfirm(orderId) {
    const id = Number(orderId);
    if (!Number.isInteger(id) || id < 1) return null;
    try {
      const result = await send('vdt-pos-order-get', { orderId: id });
      if (!result?.ok || !result.order) return null;
      return result.order;
    } catch {
      return null;
    }
  }

  /** Hỏi content đơn đang hiện trên card (khi panel chưa nhận được push). */
  function requestActiveOrderId() {
    if (activeHostOrderId) return Promise.resolve(activeHostOrderId);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (id) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (activeOrderWaiter === waiter) activeOrderWaiter = null;
        resolve(id || null);
      };
      const timer = window.setTimeout(() => finish(activeHostOrderId), 400);
      const waiter = { resolve: finish };
      activeOrderWaiter = waiter;
      try {
        window.parent.postMessage({ source: 'vdt-pos', type: 'vdt-request-active-order' }, '*');
      } catch {
        finish(null);
      }
    });
  }

  /**
   * Form đủ → tin từ form.
   * Form thiếu → tin từ đơn đang hiện trên card (nguồn đúng, luôn mới).
   */
  async function resolveConfirmMessages(draft) {
    const issue = validateDraft(draft);
    if (!issue) return { messages: buildConfirmMessages(), issue: null };

    const orderId = activeHostOrderId || (await requestActiveOrderId());
    const formPhone = confirmPhoneKey(draft.phone);
    const hostPhone = confirmPhoneKey(activeHostOrderPhone);
    if (orderId && (!formPhone || !hostPhone || formPhone === hostPhone)) {
      const order = await fetchOrderForConfirm(orderId);
      if (order) return { messages: buildConfirmMessagesFromOrder(order), issue: null };
    }
    return { messages: null, issue };
  }

  /** @param {{ syncFreeShip?: boolean }} [opts] */
  function paintPay(opts) {
    const { subtotal, codeAmount, extra, ship, free, compensation, payable } = computePayState(opts);
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

  function scrollProductsSectionIntoView() {
    const section = document.querySelector('[data-section="products"]');
    if (!(section instanceof HTMLElement)) return;
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (pickList instanceof HTMLElement) {
      pickList.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function customModalEls() {
    return {
      root: document.querySelector('[data-custom-modal]'),
      form: document.querySelector('[data-custom-form]'),
      base: document.querySelector('[data-custom-base]'),
      name: document.querySelector('[data-custom-name]'),
      price: document.querySelector('[data-custom-price]'),
      cost: document.querySelector('[data-custom-cost]'),
      qty: document.querySelector('[data-custom-qty]'),
      note: document.querySelector('[data-custom-note]'),
      weightBox: document.querySelector('[data-custom-weight]'),
      chips: document.querySelector('[data-custom-chips]'),
      extraWrap: document.querySelector('[data-custom-extra-wrap]'),
      extra: document.querySelector('[data-custom-extra]'),
      error: document.querySelector('[data-custom-error]'),
      submit: document.querySelector('[data-custom-submit]'),
    };
  }

  function setCustomError(text) {
    const { error } = customModalEls();
    const msg = String(text || '').trim();
    if (error instanceof HTMLElement) {
      error.hidden = !msg;
      error.textContent = msg;
    }
  }

  function renderCustomWeightUi() {
    if (!customDraft) return;
    const { weightBox, chips, extraWrap, extra } = customModalEls();
    const product = customDraft.product;
    const weigh = needsWeight(product);
    if (weightBox instanceof HTMLElement) weightBox.hidden = !weigh;
    if (!weigh) {
      customDraft.weight = '';
      return;
    }
    const scale = scaleOf(product);
    const chipList = uiWeightChips(scale.chips);
    const extras = scale.extras || [];
    const weight = customDraft.weight;
    if (chips instanceof HTMLElement) {
      chips.innerHTML = `
        ${chipList
          .map(
            (label) =>
              `<button type="button" class="chip" data-custom-chip="${escapeHtml(label)}" aria-pressed="${label === weight}">${escapeHtml(label)}</button>`,
          )
          .join('')}
        ${
          extras.length
            ? `<button type="button" class="chip weight-extra-toggle" data-custom-extra-toggle aria-expanded="${customDraft.extraOpen}" title="Cân nặng khác" aria-label="Cân nặng khác">+</button>`
            : ''
        }`;
    }
    if (extraWrap instanceof HTMLElement) extraWrap.hidden = !customDraft.extraOpen;
    if (extra instanceof HTMLSelectElement) {
      extra.innerHTML = `<option value="">Chọn…</option>${extras
        .map((label) => `<option value="${escapeHtml(label)}" ${label === weight ? 'selected' : ''}>${escapeHtml(label)}</option>`)
        .join('')}`;
    }
  }

  function openCustomModal(product, editIndex = null) {
    if (!product) return;
    closePickPanel();
    renderPickList();
    const existing = Number.isInteger(editIndex) && editIndex !== null ? cart[editIndex] : null;
    const baseCost = product.unitCost == null || product.unitCost === '' ? '' : groupDigits(String(product.unitCost), 8);
    const weight = existing ? String(existing.weight || '') : '';
    const scale = scaleOf(product);
    const extras = scale.extras || [];
    const chips = scale.chips || [];
    customDraft = {
      product,
      editIndex: Number.isInteger(editIndex) ? editIndex : null,
      weight,
      qty: existing ? Math.max(1, Number(existing.quantity) || 1) : 1,
      note: existing ? String(existing.note || '') : '',
      name: existing ? String(existing.name || product.name) : String(product.name || ''),
      price: groupDigits(String(existing ? existing.unitPrice : applyWeightPrice(product.price, weight)), 8),
      unitCost: existing && existing.custom ? groupDigits(String(existing.unitCost ?? ''), 8) : baseCost,
      extraOpen: Boolean(weight && extras.includes(weight) && !chips.includes(weight)),
    };
    const els = customModalEls();
    if (els.base instanceof HTMLElement) els.base.textContent = `Mẫu gốc: ${product.name}`;
    if (els.name instanceof HTMLInputElement) els.name.value = customDraft.name;
    if (els.price instanceof HTMLInputElement) els.price.value = customDraft.price;
    if (els.cost instanceof HTMLInputElement) els.cost.value = customDraft.unitCost;
    if (els.qty instanceof HTMLInputElement) els.qty.value = String(customDraft.qty);
    if (els.note instanceof HTMLInputElement) els.note.value = customDraft.note;
    if (els.submit instanceof HTMLButtonElement) {
      els.submit.textContent = customDraft.editIndex != null ? 'Cập nhật dòng' : 'Thêm vào đơn';
    }
    setCustomError('');
    renderCustomWeightUi();
    if (els.root instanceof HTMLElement) els.root.hidden = false;
    queueMicrotask(() => {
      if (els.name instanceof HTMLInputElement) {
        try {
          els.name.focus();
          els.name.select();
        } catch {
          /* ignore */
        }
      }
    });
  }

  function closeCustomModal() {
    customDraft = null;
    const { root } = customModalEls();
    if (root instanceof HTMLElement) root.hidden = true;
    setCustomError('');
  }

  function commitCustomModal() {
    if (!customDraft) return false;
    const els = customModalEls();
    const name = els.name instanceof HTMLInputElement ? els.name.value.replace(/\s+/g, ' ').trim() : '';
    if (!name) {
      setCustomError('Nhập tên sản phẩm.');
      return false;
    }
    const unitPrice = moneyOf(els.price instanceof HTMLInputElement ? els.price.value : '');
    if (!Number.isInteger(unitPrice) || unitPrice < 0) {
      setCustomError('Giá bán không hợp lệ.');
      return false;
    }
    const costRaw = els.cost instanceof HTMLInputElement ? els.cost.value.trim() : '';
    if (!costRaw) {
      setCustomError('Nhập giá vốn cho dòng tùy chỉnh.');
      return false;
    }
    const unitCost = moneyOf(costRaw);
    if (!Number.isInteger(unitCost) || unitCost < 0) {
      setCustomError('Giá vốn không hợp lệ.');
      return false;
    }
    const quantity = clampPickQty(els.qty instanceof HTMLInputElement ? els.qty.value : customDraft.qty);
    const note = els.note instanceof HTMLInputElement ? els.note.value.trim().slice(0, 160) : '';
    const weight = String(customDraft.weight || '').trim();
    if (needsWeight(customDraft.product) && !weight) {
      setCustomError('Chọn cân nặng cho bé.');
      return false;
    }
    addCustomToCart(
      customDraft.product,
      { name, unitPrice, unitCost, quantity, note, weight },
      customDraft.editIndex,
    );
    closeCustomModal();
    setFormError('');
    requestAnimationFrame(() => scrollCartSectionIntoView());
    return true;
  }

  function bindCustomModal() {
    const { root, form, price, cost, qty } = customModalEls();
    root?.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-custom-close]')) {
        closeCustomModal();
        return;
      }
      if (!customDraft) return;
      const chip = target.closest('[data-custom-chip]');
      if (chip instanceof HTMLElement) {
        customDraft.weight = chip.getAttribute('data-custom-chip') || '';
        customDraft.extraOpen = false;
        renderCustomWeightUi();
        return;
      }
      if (target.closest('[data-custom-extra-toggle]')) {
        customDraft.extraOpen = !customDraft.extraOpen;
        renderCustomWeightUi();
        return;
      }
      if (target.closest('[data-custom-qty-dec]')) {
        customDraft.qty = clampPickQty(customDraft.qty - 1);
        if (qty instanceof HTMLInputElement) qty.value = String(customDraft.qty);
        return;
      }
      if (target.closest('[data-custom-qty-inc]')) {
        customDraft.qty = clampPickQty(customDraft.qty + 1);
        if (qty instanceof HTMLInputElement) qty.value = String(customDraft.qty);
      }
    });
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      commitCustomModal();
    });
    form?.addEventListener('change', (event) => {
      if (!(event.target instanceof HTMLSelectElement) || !customDraft) return;
      if (event.target.hasAttribute('data-custom-extra') && event.target.value) {
        customDraft.weight = event.target.value;
        renderCustomWeightUi();
      }
    });
    const moneyInput = (el) => {
      el?.addEventListener('input', () => {
        if (!(el instanceof HTMLInputElement)) return;
        el.value = groupDigits(el.value, 8);
      });
    };
    moneyInput(price);
    moneyInput(cost);
    qty?.addEventListener('change', () => {
      if (!(qty instanceof HTMLInputElement) || !customDraft) return;
      customDraft.qty = clampPickQty(qty.value);
      qty.value = String(customDraft.qty);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      const modal = customModalEls().root;
      if (modal instanceof HTMLElement && !modal.hidden) {
        event.preventDefault();
        closeCustomModal();
      }
    });
  }

  function bindProducts() {
    document.querySelector('[data-scroll-products]')?.addEventListener('click', () => {
      scrollProductsSectionIntoView();
    });
    pickCats?.addEventListener('click', (event) => {
      const button = event.target instanceof Element ? event.target.closest('[data-cat]') : null;
      if (!(button instanceof HTMLElement)) return;
      pickCategory = button.dataset.cat || 'hot';
      renderPickCats();
      renderPickList();
      scrollProductsSectionIntoView();
    });
    pickQuery?.addEventListener('input', () => {
      pickText = pickQuery instanceof HTMLInputElement ? pickQuery.value : '';
      renderPickList();
    });
    pickList?.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const customBtn = target.closest('[data-pick-custom]');
      if (customBtn instanceof HTMLElement) {
        const product = products.find((item) => String(item.id) === customBtn.getAttribute('data-pick-custom'));
        if (product) openCustomModal(product, null);
        return;
      }

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
        unlockOrderTotal();
        renderCart();
        renderPickList();
        paintPay();
        scheduleDraftSave();
        return;
      }
      if (event.target instanceof Element && event.target.closest('[data-cart-edit-custom]')) {
        const product = cartLineProduct(line);
        if (product && line.custom) openCustomModal(product, index);
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
      if (event.target instanceof Element && event.target.closest('[data-cart-edit-weight]')) {
        if (cartEdit?.index === index && cartEdit.field === 'weight') {
          endCartEdit({ paint: false });
          return;
        }
        beginCartEdit(index, 'weight');
        return;
      }
      if (event.target instanceof Element && event.target.closest('[data-cart-weight-chip]')) {
        const chip = event.target.closest('[data-cart-weight-chip]');
        const weight = chip instanceof HTMLElement ? chip.getAttribute('data-cart-weight-chip') || '' : '';
        if (applyCartWeight(index, weight)) {
          endCartEdit();
        }
        return;
      }
      if (event.target instanceof Element && event.target.closest('[data-cart-weight-extra-toggle]')) {
        if (!(cartEdit && cartEdit.index === index && cartEdit.field === 'weight')) return;
        cartEdit = { ...cartEdit, extraOpen: !cartEdit.extraOpen };
        renderCart({ keepEdit: true });
        return;
      }
      if (event.target instanceof Element && event.target.closest('[data-cart-dec]')) {
        line.quantity = Math.max(1, line.quantity - 1);
        cartEdit = { index, field: 'qty' };
        unlockOrderTotal();
        renderCart({ keepEdit: true });
        paintPay();
        return;
      }
      if (event.target instanceof Element && event.target.closest('[data-cart-inc]')) {
        line.quantity = Math.min(20, line.quantity + 1);
        cartEdit = { index, field: 'qty' };
        unlockOrderTotal();
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
        return;
      }
      if (event.target instanceof HTMLSelectElement && event.target.hasAttribute('data-cart-weight-extra')) {
        if (!event.target.value) return;
        if (applyCartWeight(index, event.target.value)) endCartEdit();
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
      // Bỏ qua focusout từ nút vừa bấm (DOM bị replace khi vào chế độ sửa).
      if (!(event.target instanceof HTMLElement) || !event.target.isConnected) return;
      if (!(event.target instanceof HTMLInputElement)) return;
      if (!event.target.hasAttribute('data-cart-qty') && !event.target.hasAttribute('data-cart-note')) return;
      const row = event.target.closest('[data-cart-index]');
      if (!(row instanceof HTMLElement)) return;
      const index = Number(row.dataset.cartIndex);
      if (cartEdit.index !== index) return;
      // Còn focus trong cùng dòng đang sửa (vd. bấm +/-) → giữ chế độ sửa.
      const next = event.relatedTarget;
      if (next instanceof Node && row.contains(next)) return;
      if (event.target.hasAttribute('data-cart-qty')) commitCartQty(event.target, index);
      if (event.target.hasAttribute('data-cart-note')) commitCartNote(event.target, index);
      endCartEdit();
    });
    discountCode?.addEventListener('change', () => {
      unlockOrderTotal();
      paintPay();
    });
    discountExtra?.addEventListener('input', () => {
      if (discountExtra instanceof HTMLInputElement) discountExtra.value = groupDigits(discountExtra.value);
      unlockOrderTotal();
      paintPay();
    });
    orderTotal?.addEventListener('input', () => {
      if (orderTotal instanceof HTMLInputElement) {
        orderTotal.value = groupDigits(orderTotal.value, 9);
        orderTotal.dataset.lock = '1';
      }
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
    freeShipEl?.addEventListener('change', () => paintPay({ syncFreeShip: false }));
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
      applyChannelSource(hostChannel, { force: true });
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
      phone: (() => {
        const raw = phoneInput instanceof HTMLInputElement ? phoneInput.value.trim() : '';
        return normalizeOrderPhone(raw) || raw;
      })(),
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
        ...(line.custom
          ? {
              custom: true,
              unitCost: String(Math.max(0, Number(line.unitCost) || 0)),
            }
          : {}),
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
      if (line.custom) {
        const cost = Number(line.unitCost);
        if (!Number.isInteger(cost) || cost < 0) {
          return { el: cartEl, msg: `Nhập giá vốn cho «${line.name || 'sản phẩm tùy chỉnh'}».` };
        }
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
        authText.textContent = 'Đăng nhập admin một lần — sidebar dùng chung phiên.';
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

  bindAddress();
  bindLegacy();
  bindProducts();
  bindCustomModal();
  bindMeta();

  form?.addEventListener('input', () => scheduleDraftSave());
  form?.addEventListener('change', () => scheduleDraftSave());

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
    // Gắn ngay đơn vừa tạo/sửa — «Gửi xác nhận» không cần chờ lookup card.
    activeHostOrderId = result.id;
    activeHostOrderPhone = confirmPhoneKey(draft.phone);
    const phone = draft.phone;
    const draftChannel = hostChannel;
    const draftChatId = hostChatId;
    await clearDraft(draftChannel, draftChatId);
    await showSaved(result, { updated: editing });
    if (editing) {
      clearEditMode({ resetForm: true });
      applyChannelSource(hostChannel, { force: true });
    } else {
      resetAfterCreate();
    }
    // Báo content script tra lại khách/đơn ngay (tạo mới lẫn sửa) — không cần reload trang.
    try {
      window.parent.postMessage(
        { source: 'vdt-pos', type: 'vdt-order-updated', phone, created: !editing, orderId: result.id },
        '*',
      );
    } catch {
      /* ignore */
    }
    scrollPanelToTop();
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
              authText.textContent = 'Phiên hết hạn. Đăng nhập lại rồi tải lại.';
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
    applyChannelSource(hostChannel, { force: true });
    setFormError('');
  });

  for (const btn of editSwitchStayBtns) {
    btn.addEventListener('click', () => {
      if (submitting) return;
      stayInEditAgainstChatSwitch();
    });
  }
  editSwitchLeaveBtn?.addEventListener('click', () => {
    if (submitting) return;
    void confirmLeaveEditForChat();
  });

  sendConfirmBtn?.addEventListener('click', () => {
    if (sendingConfirm || submitting) return;
    sendingConfirm = true;
    setConfirmButtonsBusy(true);
    void (async () => {
      try {
        const draft = collectDraft();
        const resolved = await resolveConfirmMessages(draft);
        if (!resolved.messages?.length) {
          if (resolved.issue) revealInvalid(resolved.issue);
          else setFormError('Không có đơn để gửi xác nhận. Tạo đơn hoặc mở chat có đơn trước.');
          return;
        }
        clearFieldAttention();
        setFormError('');
        const result = await requestSendConfirm(resolved.messages);
        if (!result?.ok) setFormError(result?.error || 'Không gửi được tin xác nhận vào ô chat.');
        else setStatusMessage('Đã gửi tin xác nhận vào ô chat.');
      } catch {
        setFormError('Không gửi được tin xác nhận. Thử lại.');
      } finally {
        sendingConfirm = false;
        setConfirmButtonsBusy(false);
      }
    })();
  });

  sendConfirmCreateBtn?.addEventListener('click', () => {
    if (sendingConfirm || submitting) return;
    const draft = requireDraftReady();
    if (!draft) return;
    // Giữ nội dung tin trước khi reset form sau tạo đơn.
    const messages = buildConfirmMessages();
    const wasEditing = isEditing();
    sendingConfirm = true;
    submitting = true;
    setConfirmButtonsBusy(true);
    setSubmitBusy(true);
    void (async () => {
      try {
        // Ưu tiên ghi DB — không để lỗi DOM/gửi chat chặn tạo đơn.
        const outcome = await createOrUpdateOrder(draft);
        if (outcome.auth) {
          show(form, false);
          show(authBox, true);
          if (authText instanceof HTMLElement) {
            authText.textContent = 'Phiên hết hạn. Đăng nhập lại rồi tải lại.';
          }
          setFormError(wasEditing ? 'Cần đăng nhập admin để sửa đơn.' : 'Cần đăng nhập admin để tạo đơn.');
          return;
        }
        if (!outcome.ok) {
          const mapped = mapCreateError(outcome.result);
          revealInvalid(mapped);
          if (/phiên không hợp lệ/i.test(mapped.msg)) void loadBootstrap();
          setFormError(mapped.msg || (wasEditing ? 'Không lưu được đơn.' : 'Không tạo được đơn.'));
          return;
        }

        const sent = await requestSendConfirm(messages);
        if (!sent?.ok) {
          setStatusMessage(
            `Đã ${wasEditing ? 'lưu' : 'tạo'} đơn nhưng không gửi được tin xác nhận: ${sent?.error || 'thử Gửi xác nhận lại.'}`,
          );
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
    if (data.type === 'vdt-active-order') {
      const id = Number(data.orderId);
      activeHostOrderId = Number.isInteger(id) && id > 0 ? id : null;
      activeHostOrderPhone = confirmPhoneKey(typeof data.phone === 'string' ? data.phone : '');
      if (activeOrderWaiter) {
        const waiter = activeOrderWaiter;
        activeOrderWaiter = null;
        waiter.resolve(activeHostOrderId);
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
    if (data.type === 'vdt-host-channel') {
      if (typeof data.channel === 'string' && data.channel.trim()) hostChannel = data.channel.trim();
      applyChannelSource(typeof data.channel === 'string' ? data.channel : '');
      return;
    }
    if (data.type === 'vdt-fill-customer' || data.type === 'vdt-fill-phone') {
      const nextChatId = typeof data.chatId === 'string' ? data.chatId.trim() : '';
      const nextChannel = typeof data.channel === 'string' ? data.channel.trim() : hostChannel;
      void (async () => {
        const switching =
          Boolean(nextChatId) && (nextChatId !== hostChatId || nextChannel !== hostChannel);
        if (switching && isEditing()) {
          const key = `${nextChannel}:${nextChatId}`;
          if (editSwitchIgnoredKey === key) return;
          offerEditChatSwitch({
            key,
            channel: nextChannel,
            chatId: nextChatId,
            name: typeof data.name === 'string' ? data.name : '',
            phone: typeof data.phone === 'string' ? data.phone : '',
          });
          return;
        }
        const restored = nextChatId ? await switchChatContext(nextChannel, nextChatId) : false;
        await applyFillAfterChatSwitch(
          {
            name: typeof data.name === 'string' ? data.name : '',
            phone: typeof data.phone === 'string' ? data.phone : '',
            channel: typeof data.channel === 'string' ? data.channel : '',
          },
          restored,
        );
      })();
      return;
    }
    if (data.type === 'vdt-fill-address') {
      // Đang sửa đơn: không nhận địa chỉ từ chat khác cho tới khi xác nhận đổi chat / hủy sửa.
      if (isEditing()) return;
      if (draftProtectActive() && addressSelection.provinceCode) {
        // Vừa restore draft — không đè địa chỉ đã lưu.
        return;
      }
      if (typeof data.phone === 'string' && data.phone.trim()) {
        if (phoneInput instanceof HTMLInputElement && (!draftProtectActive() || !phoneInput.value.trim())) {
          phoneInput.value = data.phone.trim();
        }
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
          scheduleDraftSave();
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
      scheduleDraftSave();
    }
  });

  addressMapClose?.addEventListener('click', () => clearAddressMap());

  void loadBootstrap();
})();
