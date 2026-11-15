/**
 * Chuyển địa chỉ cũ 3 cấp → 2 cấp (ward_mapping_2025.json)
 * - Tìm nhanh theo xã/huyện/tỉnh cũ
 * - Chọn tay linh hoạt: huyện tự ra tỉnh, xã tự ra huyện+tỉnh
 */
(function () {
  'use strict';

  const MAPPING_PATH = 'data/ward_mapping_2025.json';
  const CENTRAL_PROVINCES = [
    'thành phố hồ chí minh',
    'thành phố hà nội',
    'thành phố hải phòng',
    'thành phố đà nẵng',
    'thành phố cần thơ',
    'thành phố huế',
  ];
  const SEARCH_LIMIT = 15;
  const SEARCH_MIN_LEN = 2;
  const SEARCH_DEBOUNCE_MS = 140;
  const WARD_DROPDOWN_LIMIT = 40;
  const ADMIN_TOKEN_RE = /\b(dac\s*khu|phuong|xa|thi\s*tran|thi\s*xa|quan|huyen|tinh|thanh\s*pho|tp\.?)\b/g;

  /** @type {Record<string, string>|null} */
  let mappingRaw = null;
  /** @type {{ provinces: string[], byProvince: Map<string, Map<string, string[]>>, keySet: Set<string>, searchRecords: object[], districtPairs: object[] }|null} */
  let tree = null;
  let loaded = false;
  let loadingPromise = null;
  let searchTimer = null;
  let searchActiveIndex = -1;
  /** @type {object[]} */
  let searchCurrentResults = [];
  /** 'scoped' | 'search' — chế độ list xã khi mở dropdown */
  let wardListMode = 'scoped';

  const state = {
    province: '',
    district: '',
    ward: '',
  };

  function normalizeVn(str) {
    return String(str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'd')
      .toLowerCase()
      .replace(/[''`´]/g, '')
      .replace(/\s*[-–—]\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function stripAdminPrefix(str) {
    return normalizeVn(str)
      .replace(/^(dac khu|phuong|xa|thi tran|thi xa|quan|huyen|tinh|thanh pho|tp\.?)\s+/, '')
      .trim();
  }

  function cleanSearchQuery(str) {
    return normalizeVn(str)
      .replace(ADMIN_TOKEN_RE, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Title-case nhẹ để hiển thị dropdown */
  function toDisplayLabel(raw) {
    return String(raw || '')
      .split(' ')
      .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
      .join(' ');
  }

  function abbreviateAdminLabel(raw) {
    const s = String(raw || '').trim();
    return s
      .replace(/^phường\s+/i, 'P. ')
      .replace(/^xã\s+/i, 'X. ')
      .replace(/^thị trấn\s+/i, 'TT. ')
      .replace(/^thị xã\s+/i, 'TX. ')
      .replace(/^quận\s+/i, 'Q. ')
      .replace(/^huyện\s+/i, 'H. ')
      .replace(/^tỉnh\s+/i, '')
      .replace(/^thành phố\s+/i, 'TP. ');
  }

  function formatOldLabel(rec) {
    return `${abbreviateAdminLabel(rec.ward)} · ${abbreviateAdminLabel(rec.district)} · ${abbreviateAdminLabel(rec.province)}`;
  }

  function formatNewLabel(value) {
    const parts = splitNewAddress(value);
    if (!parts) return toDisplayLabel(value);
    return `${abbreviateAdminLabel(parts.ward)} · ${abbreviateAdminLabel(parts.province)}`;
  }

  function parseOldAddressKey(key) {
    const raw = String(key || '').trim().toLowerCase();
    if (!raw || raw === 'null-null-null') return null;

    let province = null;
    let rest = null;
    const tinh = raw.match(/-(tỉnh .+)$/);
    if (tinh) {
      province = tinh[1];
      rest = raw.slice(0, -tinh[0].length);
    } else {
      for (const city of CENTRAL_PROVINCES) {
        const suffix = `-${city}`;
        if (raw.endsWith(suffix)) {
          province = city;
          rest = raw.slice(0, -suffix.length);
          break;
        }
      }
    }
    if (!province || rest == null) return null;

    const distMatch = rest.match(/^(.*?)-(quận .+|huyện .+|thị xã .+|thành phố .+)$/);
    if (!distMatch) return null;

    return {
      ward: distMatch[1].trim(),
      district: distMatch[2].trim(),
      province: province.trim(),
      key: raw,
    };
  }

  function buildTree(mapping) {
    const byProvince = new Map();
    const keySet = new Set();
    const searchRecords = [];
    const districtMap = new Map();

    for (const [key, value] of Object.entries(mapping)) {
      const parsed = parseOldAddressKey(key);
      if (!parsed || !value) continue;
      keySet.add(parsed.key);

      if (!byProvince.has(parsed.province)) {
        byProvince.set(parsed.province, new Map());
      }
      const byDistrict = byProvince.get(parsed.province);
      if (!byDistrict.has(parsed.district)) {
        byDistrict.set(parsed.district, []);
      }
      const wards = byDistrict.get(parsed.district);
      if (!wards.includes(parsed.ward)) wards.push(parsed.ward);

      const wardShort = stripAdminPrefix(parsed.ward);
      const districtShort = stripAdminPrefix(parsed.district);
      const provinceShort = stripAdminPrefix(parsed.province);
      searchRecords.push({
        key: parsed.key,
        ward: parsed.ward,
        district: parsed.district,
        province: parsed.province,
        newValue: value,
        wardShort,
        districtShort,
        provinceShort,
        haystack: `${wardShort} ${districtShort} ${provinceShort}`,
      });

      const dKey = `${parsed.district}\t${parsed.province}`;
      if (!districtMap.has(dKey)) {
        districtMap.set(dKey, {
          district: parsed.district,
          province: parsed.province,
          districtShort,
          provinceShort,
          haystack: `${districtShort} ${provinceShort}`,
        });
      }
    }

    const provinces = [...byProvince.keys()].sort((a, b) =>
      a.localeCompare(b, 'vi', { sensitivity: 'base' })
    );

    for (const [, byDistrict] of byProvince) {
      for (const [district, wards] of byDistrict) {
        wards.sort((a, b) => a.localeCompare(b, 'vi', { sensitivity: 'base' }));
        byDistrict.set(district, wards);
      }
    }

    const districtPairs = [...districtMap.values()].sort((a, b) => {
      const d = a.district.localeCompare(b.district, 'vi', { sensitivity: 'base' });
      if (d !== 0) return d;
      return a.province.localeCompare(b.province, 'vi', { sensitivity: 'base' });
    });

    return { provinces, byProvince, keySet, searchRecords, districtPairs };
  }

  async function ensureMappingLoaded() {
    if (loaded && tree) return tree;
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {
      // Load qua SW — content script không fetch được file trong package.
      const loadAsset = globalThis.shopvdLoadAsset;
      if (typeof loadAsset !== 'function') {
        throw new Error('shopvdLoadAsset unavailable — reload extension');
      }
      mappingRaw = await loadAsset(MAPPING_PATH);
      tree = buildTree(mappingRaw);
      loaded = true;
      return tree;
    })().catch((err) => {
      loadingPromise = null;
      throw err;
    });

    return loadingPromise;
  }

  function composeKey(province, district, ward) {
    return `${ward}-${district}-${province}`.toLowerCase().trim();
  }

  function splitNewAddress(value) {
    const raw = String(value || '').trim();
    const idx = raw.lastIndexOf('-');
    if (idx <= 0) return null;
    return {
      ward: raw.slice(0, idx).trim(),
      province: raw.slice(idx + 1).trim(),
    };
  }

  function findProvinceMatch(provinceName, addressData) {
    const targetFull = normalizeVn(provinceName);
    const targetShort = stripAdminPrefix(provinceName);
    const exact = [];
    const loose = [];

    for (const p of addressData || []) {
      const full = normalizeVn(p.Name);
      const short = stripAdminPrefix(p.Name);
      if (full === targetFull || short === targetShort) exact.push(p);
      else if (full.includes(targetShort) || targetShort.includes(short)) loose.push(p);
    }

    if (exact.length === 1) return exact[0];
    if (exact.length === 0 && loose.length === 1) return loose[0];
    return null;
  }

  function findWardMatch(wardName, province) {
    if (!province?.Wards?.length) return null;
    const targetFull = normalizeVn(wardName);
    const targetShort = stripAdminPrefix(wardName);
    const exact = [];
    const loose = [];

    for (const w of province.Wards) {
      const names = [w.Name, w.ShortName].filter(Boolean).map((n) => ({
        full: normalizeVn(n),
        short: stripAdminPrefix(n),
      }));
      const hitExact = names.some((n) => n.full === targetFull || n.short === targetShort);
      const hitLoose = names.some(
        (n) => n.full.includes(targetShort) || targetShort.includes(n.short)
      );
      if (hitExact) exact.push(w);
      else if (hitLoose) loose.push(w);
    }

    if (exact.length === 1) return exact[0];
    if (exact.length === 0 && loose.length === 1) return loose[0];
    return null;
  }

  /**
   * Chấm điểm 1 token trên 1 field.
   * Trả về điểm 0..1 theo mức khớp tốt nhất:
   *   1.00 = field bằng đúng token (field chỉ 1 từ = token)
   *   0.90 = có từ trong field bằng đúng token
   *   0.65 = có từ bắt đầu bằng token (prefix >= 2 ký tự)
   *   0.40 = token xuất hiện substring trong field
   *   0.00 = không khớp
   */
  function scoreTokenOnField(field, token) {
    if (!token) return 0;
    const words = field.words;
    if (!words.length) return 0;

    if (words.length === 1 && words[0] === token) return 1;
    if (words.includes(token)) return 0.9;

    if (token.length >= 2) {
      for (const w of words) {
        if (w.length > token.length && w.startsWith(token)) return 0.65;
      }
    }

    if (field.text.includes(token)) return 0.4;

    return 0;
  }

  function toFieldIndex(text) {
    return { text, words: text.split(' ').filter(Boolean) };
  }

  /**
   * Thuật toán tìm kiếm: chấm điểm từng token trên 3 field (ward/district/province),
   * cộng dồn theo trọng số, không loại bỏ sớm. Cho phép thiếu token (gõ tắt) miễn coverage đủ.
   */
  function searchLegacyAddresses(query) {
    if (!tree?.searchRecords?.length) return [];
    const cleaned = cleanSearchQuery(query);
    if (cleaned.length < SEARCH_MIN_LEN) return [];

    const tokens = cleaned.split(' ').filter(Boolean);
    if (!tokens.length) return [];

    const scored = [];
    for (const rec of tree.searchRecords) {
      if (!rec._wardIdx) {
        rec._wardIdx = toFieldIndex(rec.wardShort);
        rec._distIdx = toFieldIndex(rec.districtShort);
        rec._provIdx = toFieldIndex(rec.provinceShort);
      }

      let wardTotal = 0;
      let distTotal = 0;
      let provTotal = 0;
      let matchedTokens = 0;

      for (const t of tokens) {
        const wScore = scoreTokenOnField(rec._wardIdx, t);
        const dScore = scoreTokenOnField(rec._distIdx, t);
        const pScore = scoreTokenOnField(rec._provIdx, t);

        wardTotal += wScore;
        distTotal += dScore;
        provTotal += pScore;

        if (wScore > 0 || dScore > 0 || pScore > 0) matchedTokens += 1;
      }

      const coverage = matchedTokens / tokens.length;
      const minMatched = tokens.length <= 2 ? tokens.length : tokens.length - 1;
      if (matchedTokens === 0 || matchedTokens < minMatched || coverage < 0.5) continue;

      // Score tổng: ưu tiên ward (×10) > district (×6) > province (×3)
      let totalScore = wardTotal * 10 + distTotal * 6 + provTotal * 3;

      // Bonus: query liền mạch
      const joined = tokens.join(' ');
      if (rec._wardIdx.text.includes(joined)) totalScore += 15;
      else if (rec._distIdx.text.includes(joined)) totalScore += 8;

      // Bonus: exact match toàn bộ query
      if (rec.wardShort === cleaned) totalScore += 50;
      else if (rec.districtShort === cleaned) totalScore += 35;

      // Penalty: không khớp gì ở ward và district (chỉ province)
      if (wardTotal === 0 && distTotal === 0) totalScore *= 0.3;

      scored.push({ rec, score: totalScore, coverage, wardTotal, distTotal });
    }

    // Sắp xếp: score (giảm dần) → coverage (giảm dần) → alphabet
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.coverage !== a.coverage) return b.coverage - a.coverage;
      return a.rec.ward.localeCompare(b.rec.ward, 'vi', { sensitivity: 'base' });
    });

    return scored.slice(0, SEARCH_LIMIT).map((s) => s.rec);
  }

  function setStatus(message, type) {
    const el = document.getElementById('legacy-convert-status');
    if (!el) return;
    el.hidden = !message;
    el.textContent = message || '';
    el.classList.remove('is-ok', 'is-error', 'is-info');
    if (type) el.classList.add(type);
  }

  function updateConvertButton() {
    const btn = document.getElementById('legacy-convert-btn');
    if (!btn) return;
    btn.disabled = !(state.province && state.district && state.ward);
  }

  function setComboboxLabel(textId, btnId, label, selected) {
    const text = document.getElementById(textId);
    const btn = document.getElementById(btnId);
    if (text) text.textContent = label;
    if (btn) btn.classList.toggle('selected', Boolean(selected));
  }

  function closeLegacyCombobox(which) {
    const map = {
      province: ['legacy-province-dropdown', 'legacy-province-btn'],
      district: ['legacy-district-dropdown', 'legacy-district-btn'],
      ward: ['legacy-ward-dropdown', 'legacy-ward-btn'],
    };
    const ids = map[which];
    if (!ids) return;
    document.getElementById(ids[0])?.classList.add('hidden');
    document.getElementById(ids[1])?.classList.remove('is-open');
  }

  function closeAllLegacyComboboxes() {
    closeLegacyCombobox('province');
    closeLegacyCombobox('district');
    closeLegacyCombobox('ward');
  }

  function hideQuickSearchResults() {
    const box = document.getElementById('legacy-quick-results');
    if (!box) return;
    box.hidden = true;
    box.innerHTML = '';
    searchActiveIndex = -1;
    searchCurrentResults = [];
  }

  function clearQuickSearch() {
    const input = document.getElementById('legacy-quick-search');
    if (input) input.value = '';
    if (searchTimer) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
    hideQuickSearchResults();
  }

  function filterList(listId, searchText) {
    const list = document.getElementById(listId);
    if (!list) return;
    const q = normalizeVn(searchText);
    list.querySelectorAll('.shopvd-combobox-item').forEach((item) => {
      const text = normalizeVn(item.textContent);
      item.style.display = !q || text.includes(q) ? 'block' : 'none';
    });
  }

  function renderProvinceList() {
    const list = document.getElementById('legacy-province-list');
    if (!list || !tree) return;
    list.innerHTML = tree.provinces
      .map(
        (p) =>
          `<div class="shopvd-combobox-item" data-value="${escapeAttr(p)}">${escapeHtml(toDisplayLabel(p))}</div>`
      )
      .join('');
  }

  function renderDistrictList() {
    const list = document.getElementById('legacy-district-list');
    if (!list || !tree) return;

    // Đã chọn tỉnh → chỉ huyện thuộc tỉnh, không kèm tên tỉnh (thừa)
    // Chưa chọn tỉnh → list toàn quốc, kèm tỉnh để phân biệt trùng tên
    if (state.province) {
      const districts = [...(tree.byProvince.get(state.province)?.keys() || [])].sort((a, b) =>
        a.localeCompare(b, 'vi', { sensitivity: 'base' })
      );
      list.innerHTML = districts
        .map(
          (d) =>
            `<div class="shopvd-combobox-item" data-district="${escapeAttr(d)}" data-province="${escapeAttr(state.province)}">${escapeHtml(toDisplayLabel(d))}</div>`
        )
        .join('');
      return;
    }

    list.innerHTML = (tree.districtPairs || [])
      .map((pair) => {
        const label = `${toDisplayLabel(pair.district)} · ${abbreviateAdminLabel(pair.province)}`;
        return `<div class="shopvd-combobox-item" data-district="${escapeAttr(pair.district)}" data-province="${escapeAttr(pair.province)}">${escapeHtml(label)}</div>`;
      })
      .join('');
  }

  function setWardListHeader(text) {
    const el = document.getElementById('legacy-ward-list-header');
    if (el) el.textContent = text;
  }

  function renderWardListScoped() {
    const list = document.getElementById('legacy-ward-list');
    if (!list || !tree) return;
    const wards = tree.byProvince.get(state.province)?.get(state.district) || [];
    list.innerHTML = wards
      .map(
        (w) =>
          `<div class="shopvd-combobox-item" data-ward="${escapeAttr(w)}" data-district="${escapeAttr(state.district)}" data-province="${escapeAttr(state.province)}">${escapeHtml(toDisplayLabel(w))}</div>`
      )
      .join('');
  }

  function renderWardListSearch(query) {
    const list = document.getElementById('legacy-ward-list');
    if (!list || !tree) return;

    const cleaned = cleanSearchQuery(query);
    if (cleaned.length < SEARCH_MIN_LEN) {
      list.innerHTML =
        '<div class="shopvd-combobox-empty">Gõ ít nhất 2 ký tự để tìm phường/xã (tự nhận huyện + tỉnh)</div>';
      return;
    }

    const tokens = cleaned.split(' ').filter(Boolean);
    const scored = [];
    for (const rec of tree.searchRecords) {
      if (!fieldHasAllTokens(rec.haystack, tokens)) continue;
      const allInWard = fieldHasAllTokens(rec.wardShort, tokens);
      const exactWard = rec.wardShort === cleaned;
      if (!(exactWard || allInWard || rec.wardShort.startsWith(cleaned) || rec.wardShort.includes(cleaned))) {
        continue;
      }
      let score = 0;
      if (exactWard) score += 100;
      else if (allInWard) score += 72;
      else if (rec.wardShort.startsWith(cleaned)) score += 60;
      else score += 40;
      if (state.province && rec.province === state.province) score += 15;
      if (state.district && rec.district === state.district) score += 20;
      scored.push({ rec, score });
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.rec.ward.localeCompare(b.rec.ward, 'vi', { sensitivity: 'base' });
    });

    const rows = scored.slice(0, WARD_DROPDOWN_LIMIT);
    if (!rows.length) {
      list.innerHTML = '<div class="shopvd-combobox-empty">Không tìm thấy phường/xã phù hợp</div>';
      return;
    }

    list.innerHTML = rows
      .map(({ rec }) => {
        const label = `${toDisplayLabel(rec.ward)} · ${abbreviateAdminLabel(rec.district)} · ${abbreviateAdminLabel(rec.province)}`;
        return `<div class="shopvd-combobox-item" data-ward="${escapeAttr(rec.ward)}" data-district="${escapeAttr(rec.district)}" data-province="${escapeAttr(rec.province)}">${escapeHtml(label)}</div>`;
      })
      .join('');
  }

  function renderWardList(query) {
    if (wardListMode === 'scoped') {
      setWardListHeader('Phường / Xã (cũ)');
      renderWardListScoped();
      filterList('legacy-ward-list', query || '');
      return;
    }
    setWardListHeader('Gõ để tìm phường/xã');
    renderWardListSearch(query || '');
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/'/g, '&#39;');
  }

  function syncLegacySelection(province, district, ward) {
    state.province = province || '';
    state.district = district || '';
    state.ward = ward || '';

    if (state.province) {
      setComboboxLabel('legacy-province-text', 'legacy-province-btn', toDisplayLabel(state.province), true);
    } else {
      setComboboxLabel('legacy-province-text', 'legacy-province-btn', 'Chọn tỉnh/TP cũ', false);
    }

    if (state.district) {
      setComboboxLabel('legacy-district-text', 'legacy-district-btn', toDisplayLabel(state.district), true);
    } else {
      setComboboxLabel('legacy-district-text', 'legacy-district-btn', 'Chọn quận/huyện', false);
    }

    if (state.ward) {
      setComboboxLabel('legacy-ward-text', 'legacy-ward-btn', toDisplayLabel(state.ward), true);
    } else {
      setComboboxLabel('legacy-ward-text', 'legacy-ward-btn', 'Chọn phường/xã', false);
    }

    updateConvertButton();
  }

  function renderQuickSearchResults(results, query) {
    const box = document.getElementById('legacy-quick-results');
    if (!box) return;

    searchCurrentResults = results;
    searchActiveIndex = results.length ? 0 : -1;

    const cleaned = cleanSearchQuery(query);
    if (cleaned.length < SEARCH_MIN_LEN) {
      hideQuickSearchResults();
      return;
    }

    if (!results.length) {
      box.hidden = false;
      box.innerHTML =
        '<div class="shopvd-legacy-search-empty">Không tìm thấy. Thử tên xã/huyện cụ thể hơn, hoặc dùng “Chọn tay 3 cấp”.</div>';
      return;
    }

    box.hidden = false;
    box.innerHTML = results
      .map(
        (rec, idx) => `
        <button type="button" class="shopvd-legacy-search-item${idx === 0 ? ' is-active' : ''}" role="option" data-index="${idx}" data-key="${escapeAttr(rec.key)}">
          <span class="shopvd-legacy-search-old">${escapeHtml(formatOldLabel(rec))}</span>
          <span class="shopvd-legacy-search-new">→ ${escapeHtml(formatNewLabel(rec.newValue))}</span>
        </button>`
      )
      .join('');
  }

  function setSearchActiveIndex(next) {
    const box = document.getElementById('legacy-quick-results');
    if (!box || box.hidden || !searchCurrentResults.length) return;
    const max = searchCurrentResults.length - 1;
    searchActiveIndex = Math.max(0, Math.min(max, next));
    box.querySelectorAll('.shopvd-legacy-search-item').forEach((el, idx) => {
      el.classList.toggle('is-active', idx === searchActiveIndex);
    });
    box.querySelector('.shopvd-legacy-search-item.is-active')?.scrollIntoView({ block: 'nearest' });
  }

  async function runQuickSearch(query) {
    try {
      await ensureMappingLoaded();
    } catch (err) {
      setStatus('Không tải được bảng đổi địa chỉ', 'is-error');
      console.error('[ShopVD] ward_mapping load failed:', err);
      hideQuickSearchResults();
      return;
    }
    const results = searchLegacyAddresses(query);
    renderQuickSearchResults(results, query);
  }

  function scheduleQuickSearch(query) {
    if (searchTimer) clearTimeout(searchTimer);
    const cleaned = cleanSearchQuery(query);
    if (cleaned.length < SEARCH_MIN_LEN) {
      hideQuickSearchResults();
      return;
    }
    searchTimer = setTimeout(() => {
      searchTimer = null;
      runQuickSearch(query);
    }, SEARCH_DEBOUNCE_MS);
  }

  async function openLegacyCombobox(which) {
    try {
      await ensureMappingLoaded();
    } catch (err) {
      setStatus('Không tải được bảng đổi địa chỉ', 'is-error');
      console.error('[ShopVD] ward_mapping load failed:', err);
      return;
    }

    hideQuickSearchResults();
    closeAllLegacyComboboxes();
    if (typeof window.closeAllComboboxes === 'function') {
      window.closeAllComboboxes();
    }

    if (which === 'province') {
      renderProvinceList();
      document.getElementById('legacy-province-dropdown')?.classList.remove('hidden');
      document.getElementById('legacy-province-btn')?.classList.add('is-open');
      const search = document.getElementById('legacy-province-search');
      if (search) {
        search.value = '';
        search.focus();
      }
      filterList('legacy-province-list', '');
    } else if (which === 'district') {
      renderDistrictList();
      document.getElementById('legacy-district-dropdown')?.classList.remove('hidden');
      document.getElementById('legacy-district-btn')?.classList.add('is-open');
      const search = document.getElementById('legacy-district-search');
      if (search) {
        search.value = '';
        search.focus();
      }
      filterList('legacy-district-list', '');
      if (!state.province) {
        setStatus('Chọn huyện — hệ thống tự điền tỉnh', 'is-info');
      }
    } else if (which === 'ward') {
      wardListMode = state.province && state.district ? 'scoped' : 'search';
      document.getElementById('legacy-ward-dropdown')?.classList.remove('hidden');
      document.getElementById('legacy-ward-btn')?.classList.add('is-open');
      const search = document.getElementById('legacy-ward-search');
      if (search) {
        search.value = '';
        search.focus();
      }
      renderWardList('');
      if (wardListMode === 'search') {
        setStatus('Gõ tên xã — hệ thống tự điền huyện + tỉnh', 'is-info');
      }
    }
  }

  function selectLegacyProvince(value) {
    syncLegacySelection(value, '', '');
    closeLegacyCombobox('province');
    setStatus('', null);
    setTimeout(() => openLegacyCombobox('district'), 80);
  }

  function selectLegacyDistrict(district, province) {
    const nextProvince = province || state.province;
    if (!district || !nextProvince) {
      setStatus('Không xác định được tỉnh của huyện này', 'is-error');
      return;
    }
    syncLegacySelection(nextProvince, district, '');
    closeLegacyCombobox('district');
    setStatus('', null);
    setTimeout(() => openLegacyCombobox('ward'), 80);
  }

  function selectLegacyWard(ward, district, province) {
    const nextDistrict = district || state.district;
    const nextProvince = province || state.province;
    if (!ward || !nextDistrict || !nextProvince) {
      setStatus('Không xác định đủ địa chỉ của xã này', 'is-error');
      return;
    }
    syncLegacySelection(nextProvince, nextDistrict, ward);
    closeLegacyCombobox('ward');
    setStatus('', null);
    convertLegacyAddress();
  }

  async function applyMappedValue(mapped, oldParts) {
    const btn = document.getElementById('legacy-convert-btn');
    const parts = splitNewAddress(mapped);
    if (!parts) {
      setStatus('Dữ liệu mới không hợp lệ', 'is-error');
      return false;
    }

    if (typeof window.ShopVDAddressAPI?.ensureLoaded === 'function') {
      await window.ShopVDAddressAPI.ensureLoaded();
    }

    const addressData = window.ShopVDAddressAPI?.getAddressData?.() || [];
    const province = findProvinceMatch(parts.province, addressData);
    if (!province) {
      setStatus(`Không khớp tỉnh mới: ${parts.province}`, 'is-error');
      return false;
    }

    const ward = findWardMatch(parts.ward, province);
    if (!ward) {
      setStatus(`Không khớp phường/xã mới: ${parts.ward}`, 'is-error');
      return false;
    }

    if (oldParts) {
      syncLegacySelection(oldParts.province, oldParts.district, oldParts.ward);
    }

    if (btn) btn.disabled = true;
    window.ShopVDAddressAPI.selectProvince(province.Id, { silent: true });
    window.ShopVDAddressAPI.selectWard(ward.Id, province.Id, { silent: true });
    setStatus(`Đã điền: ${ward.Name} · ${province.Name}`, 'is-ok');
    updateConvertButton();
    return true;
  }

  async function applySearchResult(rec) {
    if (!rec?.key) return;
    try {
      await ensureMappingLoaded();
      const mapped = rec.newValue || mappingRaw?.[rec.key];
      if (!mapped) {
        setStatus('Không tìm thấy trong bảng đổi địa chỉ', 'is-error');
        return;
      }
      hideQuickSearchResults();
      await applyMappedValue(mapped, rec);
    } catch (err) {
      console.error('[ShopVD] apply search result failed:', err);
      setStatus(err?.message || 'Chuyển đổi thất bại', 'is-error');
      updateConvertButton();
    }
  }

  async function convertLegacyAddress() {
    if (!state.province || !state.district || !state.ward) {
      setStatus('Chọn đủ 3 cấp địa chỉ cũ', 'is-info');
      return;
    }

    try {
      await ensureMappingLoaded();
      const key = composeKey(state.province, state.district, state.ward);
      const mapped = mappingRaw?.[key];
      if (!mapped) {
        setStatus('Không tìm thấy trong bảng đổi địa chỉ', 'is-error');
        return;
      }
      await applyMappedValue(mapped, {
        province: state.province,
        district: state.district,
        ward: state.ward,
      });
    } catch (err) {
      console.error('[ShopVD] convert legacy address failed:', err);
      setStatus(err?.message || 'Chuyển đổi thất bại', 'is-error');
      updateConvertButton();
    }
  }

  function setPanelOpen(open) {
    const box = document.querySelector('#shopvd-sidebar .shopvd-address-box');
    const panel = document.getElementById('legacy-address-panel');
    const toggle = document.getElementById('legacy-toggle-btn');
    if (!panel || !toggle) return;

    box?.classList.toggle('legacy-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');

    if (open) {
      panel.hidden = false;
      ensureMappingLoaded().catch(() => {});
      setTimeout(() => document.getElementById('legacy-province-btn')?.focus(), 60);
    } else {
      closeAllLegacyComboboxes();
      panel.hidden = true;
    }
  }

  function togglePanel() {
    const toggle = document.getElementById('legacy-toggle-btn');
    setPanelOpen(toggle?.getAttribute('aria-expanded') !== 'true');
  }

  function resetLegacyAddressConvert() {
    state.province = '';
    state.district = '';
    state.ward = '';
    setComboboxLabel('legacy-province-text', 'legacy-province-btn', 'Chọn tỉnh/TP cũ', false);
    setComboboxLabel('legacy-district-text', 'legacy-district-btn', 'Chọn quận/huyện', false);
    setComboboxLabel('legacy-ward-text', 'legacy-ward-btn', 'Chọn phường/xã', false);
    clearQuickSearch();
    closeAllLegacyComboboxes();
    setStatus('', null);
    updateConvertButton();
    setPanelOpen(false);
  }

  function bindEvents() {
    document.getElementById('legacy-toggle-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePanel();
    });

    document.getElementById('legacy-province-btn')?.addEventListener('click', () => openLegacyCombobox('province'));
    document.getElementById('legacy-district-btn')?.addEventListener('click', () => openLegacyCombobox('district'));
    document.getElementById('legacy-ward-btn')?.addEventListener('click', () => openLegacyCombobox('ward'));

    document.getElementById('legacy-province-search')?.addEventListener('input', (e) => {
      filterList('legacy-province-list', e.target.value);
    });
    document.getElementById('legacy-district-search')?.addEventListener('input', (e) => {
      filterList('legacy-district-list', e.target.value);
    });
    document.getElementById('legacy-ward-search')?.addEventListener('input', (e) => {
      if (wardListMode === 'search') {
        renderWardList(e.target.value);
      } else {
        filterList('legacy-ward-list', e.target.value);
      }
    });

    document.getElementById('legacy-province-list')?.addEventListener('click', (e) => {
      const item = e.target.closest('.shopvd-combobox-item');
      const value = item?.getAttribute('data-value');
      if (value) selectLegacyProvince(value);
    });
    document.getElementById('legacy-district-list')?.addEventListener('click', (e) => {
      const item = e.target.closest('.shopvd-combobox-item');
      if (!item) return;
      const district = item.getAttribute('data-district');
      const province = item.getAttribute('data-province');
      if (district) selectLegacyDistrict(district, province);
    });
    document.getElementById('legacy-ward-list')?.addEventListener('click', (e) => {
      const item = e.target.closest('.shopvd-combobox-item');
      if (!item) return;
      const ward = item.getAttribute('data-ward');
      const district = item.getAttribute('data-district');
      const province = item.getAttribute('data-province');
      if (ward) selectLegacyWard(ward, district, province);
    });

    document.getElementById('legacy-convert-btn')?.addEventListener('click', convertLegacyAddress);

    const quickSearch = document.getElementById('legacy-quick-search');
    const quickResults = document.getElementById('legacy-quick-results');

    quickSearch?.addEventListener('input', (e) => {
      closeAllLegacyComboboxes();
      scheduleQuickSearch(e.target.value);
    });

    quickSearch?.addEventListener('keydown', (e) => {
      const open = quickResults && !quickResults.hidden && searchCurrentResults.length;
      if (e.key === 'ArrowDown' && open) {
        e.preventDefault();
        setSearchActiveIndex(searchActiveIndex < 0 ? 0 : searchActiveIndex + 1);
      } else if (e.key === 'ArrowUp' && open) {
        e.preventDefault();
        setSearchActiveIndex(searchActiveIndex < 0 ? 0 : searchActiveIndex - 1);
      } else if (e.key === 'Enter' && open && searchActiveIndex >= 0) {
        e.preventDefault();
        applySearchResult(searchCurrentResults[searchActiveIndex]);
      } else if (e.key === 'Escape') {
        hideQuickSearchResults();
      }
    });

    quickSearch?.addEventListener('focus', () => {
      ensureMappingLoaded().catch(() => {});
      if (cleanSearchQuery(quickSearch.value).length >= SEARCH_MIN_LEN && searchCurrentResults.length) {
        const box = document.getElementById('legacy-quick-results');
        if (box) box.hidden = false;
      }
    });

    quickResults?.addEventListener('click', (e) => {
      const item = e.target.closest('.shopvd-legacy-search-item');
      if (!item) return;
      const idx = Number(item.getAttribute('data-index'));
      const rec = searchCurrentResults[idx];
      if (rec) applySearchResult(rec);
    });

    quickResults?.addEventListener('mousemove', (e) => {
      const item = e.target.closest('.shopvd-legacy-search-item');
      if (!item) return;
      const idx = Number(item.getAttribute('data-index'));
      if (!Number.isNaN(idx) && idx !== searchActiveIndex) setSearchActiveIndex(idx);
    });

    document.addEventListener('click', (e) => {
      const panel = document.getElementById('legacy-address-panel');
      const toggle = document.getElementById('legacy-toggle-btn');
      const searchWrap = document.querySelector('.shopvd-legacy-search-wrap');
      if (searchWrap?.contains(e.target)) return;
      if ((panel && panel.contains(e.target)) || (toggle && toggle.contains(e.target))) {
        hideQuickSearchResults();
        return;
      }
      closeAllLegacyComboboxes();
      hideQuickSearchResults();
    });
  }

  function init() {
    if (!document.getElementById('legacy-quick-search') || !document.getElementById('legacy-address-panel')) return;
    bindEvents();
    resetLegacyAddressConvert();
  }

  window.ShopVDLegacyAddress = {
    init,
    reset: resetLegacyAddressConvert,
    closeAll: closeAllLegacyComboboxes,
    setOpen: setPanelOpen,
  };
})();
