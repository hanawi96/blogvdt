/**
 * Tìm địa chỉ cũ → mới. Cùng quy tắc chặt với src/features/address/legacy.ts
 * (ưu tiên cụm phường/xã liền mạch, không chấm điểm mờ từng token).
 */

const SEARCH_LIMIT = 20;
const EXPANSION_RESERVE = 8;
const CENTRAL_PROVINCES = [
  'thành phố hồ chí minh',
  'thành phố hà nội',
  'thành phố hải phòng',
  'thành phố đà nẵng',
  'thành phố cần thơ',
  'thành phố huế',
];

/**
 * Token dính chữ / viết tắt chat → tách thành token khớp địa chỉ 2 cấp.
 * Tỉnh cũ (sau sáp nhập 2025) map sang tỉnh mới còn trong danh mục.
 * Đồng bộ với src/features/address/legacy.ts.
 */
const ALIAS_TOKENS = {
  hcm: ['ho', 'chi', 'minh'],
  tphcm: ['ho', 'chi', 'minh'],
  saigon: ['ho', 'chi', 'minh'],
  sg: ['ho', 'chi', 'minh'],
  hn: ['ha', 'noi'],
  hanoi: ['ha', 'noi'],
  dn: ['da', 'nang'],
  danang: ['da', 'nang'],
  hp: ['hai', 'phong'],
  haiphong: ['hai', 'phong'],
  ct: ['can', 'tho'],
  cantho: ['can', 'tho'],
  hue: ['hue'],
  tphue: ['hue'],

  angiang: ['an', 'giang'],
  bacninh: ['bac', 'ninh'],
  camau: ['ca', 'mau'],
  caobang: ['cao', 'bang'],
  daklak: ['dak', 'lak'],
  dienbien: ['dien', 'bien'],
  dongnai: ['dong', 'nai'],
  dongthap: ['dong', 'thap'],
  gialai: ['gia', 'lai'],
  hatinh: ['ha', 'tinh'],
  hungyen: ['hung', 'yen'],
  khanhhoa: ['khanh', 'hoa'],
  laichau: ['lai', 'chau'],
  lamdong: ['lam', 'dong'],
  langson: ['lang', 'son'],
  laocai: ['lao', 'cai'],
  nghean: ['nghe', 'an'],
  ninhbinh: ['ninh', 'binh'],
  phutho: ['phu', 'tho'],
  quangngai: ['quang', 'ngai'],
  quangninh: ['quang', 'ninh'],
  quangtri: ['quang', 'tri'],
  sonla: ['son', 'la'],
  tayninh: ['tay', 'ninh'],
  thainguyen: ['thai', 'nguyen'],
  thanhhoa: ['thanh', 'hoa'],
  tuyenquang: ['tuyen', 'quang'],
  vinhlong: ['vinh', 'long'],

  kiengiang: ['an', 'giang'],
  bacgiang: ['bac', 'ninh'],
  baclieu: ['ca', 'mau'],
  phuyen: ['dak', 'lak'],
  binhphuoc: ['dong', 'nai'],
  tiengiang: ['dong', 'thap'],
  binhdinh: ['gia', 'lai'],
  thaibinh: ['hung', 'yen'],
  ninhthuan: ['khanh', 'hoa'],
  daknong: ['lam', 'dong'],
  binhthuan: ['lam', 'dong'],
  yenbai: ['lao', 'cai'],
  hanam: ['ninh', 'binh'],
  namdinh: ['ninh', 'binh'],
  vinhphuc: ['phu', 'tho'],
  hoabinh: ['phu', 'tho'],
  kontum: ['quang', 'ngai'],
  quangbinh: ['quang', 'tri'],
  quangnam: ['da', 'nang'],
  longan: ['tay', 'ninh'],
  backan: ['thai', 'nguyen'],
  hagiang: ['tuyen', 'quang'],
  haiduong: ['hai', 'phong'],
  soctrang: ['can', 'tho'],
  haugiang: ['can', 'tho'],
  bentre: ['vinh', 'long'],
  travinh: ['vinh', 'long'],
  binhduong: ['ho', 'chi', 'minh'],
  bariavungtau: ['ho', 'chi', 'minh'],
  brvt: ['ho', 'chi', 'minh'],
  vungtau: ['vung', 'tau'],

  langbiang: ['lang', 'biang'],
  dalat: ['da', 'lat'],
  tpdalat: ['da', 'lat'],
  nhatrang: ['nha', 'trang'],
  phuquoc: ['phu', 'quoc'],
  buonmathuot: ['buon', 'ma', 'thuot'],
  bmt: ['buon', 'ma', 'thuot'],
  thudautmot: ['thu', 'dau', 'mot'],
  tdm: ['thu', 'dau', 'mot'],
  govap: ['go', 'vap'],
  binhthanh: ['binh', 'thanh'],
  thuduc: ['thu', 'duc'],
  binhtan: ['binh', 'tan'],
  phunhuan: ['phu', 'nhuan'],
  tanbinh: ['tan', 'binh'],
  tanphu: ['tan', 'phu'],
  hocmon: ['hoc', 'mon'],
  binhchanh: ['binh', 'chanh'],
  cangio: ['can', 'gio'],
  nhabe: ['nha', 'be'],
  quan1: ['quan', '1'],
  quan2: ['quan', '2'],
  quan3: ['quan', '3'],
  quan4: ['quan', '4'],
  quan5: ['quan', '5'],
  quan6: ['quan', '6'],
  quan7: ['quan', '7'],
  quan8: ['quan', '8'],
  quan9: ['quan', '9'],
  quan10: ['quan', '10'],
  quan11: ['quan', '11'],
  quan12: ['quan', '12'],
};

/** Typo hẹp cao nguyên / tên dễ viết sai (so khớp token, không thay query). */
const SOFT_TOKEN_EQ = {
  than: ['thanh'],
  thanh: ['than'],
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

function loose(value) {
  return normalizeVn(value)
    .replace(/[-–—'’']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripWard(text) {
  return text.replace(/^(?:phuong|xa|thi tran|thi xa)\s+/, '').trim();
}

function stripDistrict(text) {
  return text.replace(/^(?:huyen|quan|thi xa|thanh pho|thi tran)\s+/, '').trim();
}

function stripProvince(text) {
  return text.replace(/^(?:tinh|thanh pho|tp)\s+/, '').trim();
}

function wordTokens(text) {
  return text.split(' ').filter((token) => token.length > 0);
}

/** «đắklắk» → dak+lak; «dakla» (cắt 1–2 ký tự) nếu chỉ khớp một tỉnh. */
function buildProvinceCompactAliases(provinceBares) {
  const map = new Map();
  const prefixes = new Map();
  for (const bare of provinceBares) {
    const parts = wordTokens(bare);
    if (parts.length < 2) continue;
    const compact = parts.join('');
    if (compact.length < 4) continue;
    if (ALIAS_TOKENS[compact] || map.has(compact)) continue;
    map.set(compact, parts);
    for (let cut = 1; cut <= 2; cut += 1) {
      if (compact.length - cut < 5) continue;
      const prefix = compact.slice(0, compact.length - cut);
      if (ALIAS_TOKENS[prefix] || map.has(prefix)) continue;
      prefixes.set(prefix, prefixes.has(prefix) ? null : parts);
    }
  }
  for (const [prefix, parts] of prefixes) {
    if (parts) map.set(prefix, parts);
  }
  return map;
}

/**
 * Bong bóng chat cắt đuôi tỉnh: «đắk lạ» / «đắk lắ» → dak lak
 * khi đúng một tỉnh có cùng số từ và từ cuối là tiền tố (≥ 2 ký tự).
 */
function repairTruncatedProvince(tokens, provinceBares) {
  const out = tokens.slice();
  let best = null;
  for (const bare of provinceBares) {
    const parts = wordTokens(bare);
    if (parts.length < 2 || parts.length > out.length) continue;
    const start = out.length - parts.length;
    let ok = true;
    let truncated = false;
    for (let i = 0; i < parts.length; i += 1) {
      const query = out[start + i];
      const part = parts[i];
      if (query === part) continue;
      if (i === parts.length - 1 && part.startsWith(query) && query.length >= 2 && query.length < part.length) {
        truncated = true;
        continue;
      }
      ok = false;
      break;
    }
    if (!ok || !truncated) continue;
    if (best) return tokens.slice();
    best = { start, parts };
  }
  if (!best) return out;
  return [...out.slice(0, best.start), ...best.parts];
}

/** «pongdrang» → pong+drang, «krongbuk» → krong+buk khi cụm dính đúng một cách tách. */
function buildPlaceCompactSplits(entries) {
  const seen = new Map();
  const add = (parts) => {
    if (parts.length < 2 || parts.length > 3) return;
    const compact = parts.join('');
    if (compact.length < 6 || ALIAS_TOKENS[compact]) return;
    const prev = seen.get(compact);
    if (prev === undefined) seen.set(compact, parts);
    else if (prev && prev.join(' ') !== parts.join(' ')) seen.set(compact, null);
  };
  for (const entry of entries) {
    add(entry.wardTokens);
    add(entry.districtTokens);
  }
  const out = new Map();
  for (const [compact, parts] of seen) {
    if (parts) out.set(compact, parts);
  }
  return out;
}

function expandAlias(token, provinceCompacts, placeSplits) {
  if (ALIAS_TOKENS[token]) return ALIAS_TOKENS[token];
  const fromProvince = provinceCompacts && provinceCompacts.get(token);
  if (fromProvince) return fromProvince;
  const fromPlace = placeSplits && placeSplits.get(token);
  if (fromPlace) return fromPlace;
  // Typo thiếu/thừa 1 ký tự trên tên dính: «pongdran» → pong+drang.
  // Chỉ insert/delete (|len| lệch 1) — không thay thế cùng dài (tránh nguyen ≈ ngayen).
  if (placeSplits && token.length >= 6) {
    let best = null;
    let ambiguous = false;
    for (const [compact, parts] of placeSplits) {
      if (Math.abs(token.length - compact.length) !== 1) continue;
      const cost = tokenMatchCost(token, compact);
      if (cost !== 1) continue;
      if (!best || cost < best.cost) {
        best = { parts, cost };
        ambiguous = false;
      } else if (parts.join(' ') !== best.parts.join(' ')) {
        ambiguous = true;
      }
    }
    if (best && !ambiguous) return best.parts;
  }
  return [token];
}

/** Trừ điểm mỗi bước edit khi khớp soft — exact luôn thắng. */
const FUZZY_COST_PER_EDIT = 40;

function maxAllowedTokenDistance(leftLen, rightLen) {
  const maxLen = Math.max(leftLen, rightLen);
  const delta = Math.abs(leftLen - rightLen);
  if (maxLen >= 8 && delta <= 2) return 2;
  if (maxLen >= 5 && delta <= 1) return 1;
  return 0;
}

/** Levenshtein có trần; trả -1 nếu chắc chắn vượt maxDist. */
function tokenEditDistance(a, b, maxDist) {
  if (a === b) return 0;
  if (maxDist <= 0) return -1;
  const aLen = a.length;
  const bLen = b.length;
  if (Math.abs(aLen - bLen) > maxDist) return -1;
  if (!aLen) return bLen <= maxDist ? bLen : -1;
  if (!bLen) return aLen <= maxDist ? aLen : -1;

  let prev = Array.from({ length: bLen + 1 }, (_, j) => j);
  let curr = Array.from({ length: bLen + 1 }, () => 0);
  for (let i = 1; i <= aLen; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];
    const aCh = a[i - 1];
    for (let j = 1; j <= bLen; j += 1) {
      const cost = aCh === b[j - 1] ? 0 : 1;
      const value = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      curr[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > maxDist) return -1;
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  const dist = prev[bLen];
  return dist <= maxDist ? dist : -1;
}

/**
 * 0 = exact / SOFT_TOKEN_EQ; 1–2 = soft typo; Infinity = không khớp.
 * Token ngắn (<5) không soft; cùng ký tự đầu khi soft.
 */
function tokenMatchCost(left, right) {
  if (left === right) return 0;
  const soft = SOFT_TOKEN_EQ[left];
  if (soft && soft.includes(right)) return 0;
  if (!left || !right || left[0] !== right[0]) return Number.POSITIVE_INFINITY;
  const allowed = maxAllowedTokenDistance(left.length, right.length);
  if (allowed === 0) return Number.POSITIVE_INFINITY;
  const dist = tokenEditDistance(left, right, allowed);
  if (dist < 0) return Number.POSITIVE_INFINITY;
  return dist;
}

function tokensEqual(left, right) {
  return Number.isFinite(tokenMatchCost(left, right));
}

function tokensIncludeCost(hay, needle) {
  let best = Number.POSITIVE_INFINITY;
  for (const token of hay) {
    const cost = tokenMatchCost(token, needle);
    if (cost < best) best = cost;
  }
  return best;
}

function tokensInclude(hay, needle) {
  return Number.isFinite(tokensIncludeCost(hay, needle));
}

function abbreviateAdminLabel(raw) {
  return String(raw || '')
    .trim()
    .replace(/^phường\s+/i, 'P. ')
    .replace(/^xã\s+/i, 'X. ')
    .replace(/^thị trấn\s+/i, 'TT. ')
    .replace(/^thị xã\s+/i, 'TX. ')
    .replace(/^quận\s+/i, 'Q. ')
    .replace(/^huyện\s+/i, 'H. ')
    .replace(/^tỉnh\s+/i, '')
    .replace(/^thành phố\s+/i, 'TP. ');
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
  };
}

function splitNewAddress(value) {
  const raw = String(value || '').trim();
  const idx = raw.lastIndexOf('-');
  if (idx <= 0) return null;
  return { ward: raw.slice(0, idx).trim(), province: raw.slice(idx + 1).trim() };
}

function findProvince(rows, provinceName) {
  const targetFull = normalizeVn(provinceName);
  const targetShort = stripProvince(loose(provinceName));
  const exact = [];
  const soft = [];
  for (const row of rows) {
    const full = normalizeVn(row[1]);
    const short = stripProvince(loose(row[1]));
    const item = { code: row[0], name: row[1], wards: row[2] };
    if (full === targetFull || short === targetShort) exact.push(item);
    else if (full.includes(targetShort) || targetShort.includes(short)) soft.push(item);
  }
  if (exact.length === 1) return exact[0];
  if (exact.length === 0 && soft.length === 1) return soft[0];
  return null;
}

function findWard(wards, wardName) {
  const targetFull = normalizeVn(wardName);
  const targetShort = stripWard(loose(wardName));
  const exact = [];
  const soft = [];
  for (const [code, name] of wards) {
    const full = normalizeVn(name);
    const short = stripWard(loose(name));
    if (full === targetFull || short === targetShort) exact.push({ code, name });
    else if (full.includes(targetShort) || targetShort.includes(short)) soft.push({ code, name });
  }
  if (exact.length === 1) return exact[0];
  if (exact.length === 0 && soft.length === 1) return soft[0];
  return null;
}

/**
 * Sửa typo nhãn hành chính hay gặp trong chat (tình→tỉnh, huyên→huyện…).
 * Chỉ khi đứng như từ riêng trước tên chỗ — tránh đụng tên đường hiếm.
 */
const ASCII_ADMIN_LABELS = {
  xa: 'xã',
  phuong: 'phường',
  quan: 'quận',
  huyen: 'huyện',
  tinh: 'tỉnh',
  'thanh pho': 'thành phố',
  'thi tran': 'thị trấn',
};

/**
 * Sửa typo/không dấu của nhãn hành chính.
 * - tình→tỉnh (sai dấu, mọi vị trí từ riêng)
 * - xa/phuong/quan/huyen/tinh không dấu: đầu câu hoặc sau phẩy / giữa các cấp
 */
function repairAdminLabelTypos(text) {
  let out = String(text || '');
  out = out.replace(/(^|[^\p{L}0-9])(?:tình|tỉnhh|tinhh)(?=$|[^\p{L}0-9])/giu, '$1tỉnh');
  out = out.replace(/(^|[^\p{L}0-9])(?:huyên|huyểnn|huyeen)(?=$|[^\p{L}0-9])/giu, '$1huyện');
  out = out.replace(/(^|[^\p{L}0-9])(?:quạn|quaận|quaan)(?=$|[^\p{L}0-9])/giu, '$1quận');
  out = out.replace(/(^|[^\p{L}0-9])(?:phưởng|phuờng|phuongg)(?=$|[^\p{L}0-9])/giu, '$1phường');
  out = out.replace(/(^|[^\p{L}0-9])(?:thị\s*trân|thitrấn)(?=$|[^\p{L}0-9])/giu, '$1thị trấn');
  out = out.replace(/(^|[^\p{L}0-9])(?:thành\s*phô)(?=$|[^\p{L}0-9])/giu, '$1thành phố');
  // Không dấu đứng đầu cụm hoặc giữa các cấp: «xa trang viet huyen me linh».
  out = out.replace(
    /(^|[,;\n]\s*|\s+)(xa|phuong|quan|huyen|tinh|thanh\s+pho|thi\s+tran)\b(?=\s+\p{L})/giu,
    (full, pre, label) => {
      const key = String(label).toLowerCase().replace(/\s+/g, ' ');
      const fixed = ASCII_ADMIN_LABELS[key];
      return fixed ? `${pre}${fixed}` : full;
    },
  );
  return out;
}

/**
 * p5 / P.5 / ph 14 → Phường N; Q8 / q.8 → Quận N.
 * P.Tân / Q.Tân / X.Tráng / H.Mê / TT. / TX. / TP. — mở nhãn đầy đủ trước khi đổi dấu chấm thành phẩy.
 * Quận 1–12 mà chưa có tỉnh → thêm TP.HCM.
 */
function expandWardDistrictShortcuts(text) {
  let out = String(text || '');
  out = out.replace(/(^|[^0-9\p{L}])(?:q|quận)\.?\s*(\d{1,2})(?=$|[^0-9])/giu, '$1Quận $2');
  out = out.replace(/(^|[^0-9\p{L}])(?:p|ph|phường)\.?\s*(\d{1,2})(?=$|[^0-9])/giu, '$1Phường $2');
  // P.Tân / X.tráng / H.mê / … — bắt buộc dấu . hoặc / (tránh nuốt «pơngdran», chữ đơn «h»).
  out = out.replace(/(^|[^0-9\p{L}])(?:p|ph)[./]\s*(?=\p{L})/giu, '$1Phường ');
  out = out.replace(/(^|[^0-9\p{L}])q[./]\s*(?=\p{L})/giu, '$1Quận ');
  out = out.replace(/(^|[^0-9\p{L}])x[./]\s*(?=\p{L})/giu, '$1Xã ');
  out = out.replace(/(^|[^0-9\p{L}])h[./]\s*(?=\p{L})/giu, '$1Huyện ');
  out = out.replace(/(^|[^0-9\p{L}])tt[./]\s*(?=\p{L})/giu, '$1Thị trấn ');
  out = out.replace(/(^|[^0-9\p{L}])tx[./]\s*(?=\p{L})/giu, '$1Thị xã ');
  out = out.replace(/(^|[^0-9\p{L}])tp[./]\s*(?=\p{L})/giu, '$1Thành phố ');
  const folded = loose(out);
  const hasNumberedDistrict = /\bquan\s+(?:[1-9]|1[0-2])\b/.test(folded);
  const hasProvince =
    /\b(?:tinh|thanh pho|tp|hcm|tphcm|sai gon|sg|ho chi minh|ha noi|da nang|hai phong|can tho|hue)\b/.test(folded) ||
    /\b(?:tỉnh|thành phố)\b/i.test(out);
  if (hasNumberedDistrict && !hasProvince) {
    out = `${out.replace(/[,\s]+$/g, '')}, Thành phố Hồ Chí Minh`;
  }
  return out;
}

/** SĐT VN trong chat: 0944887829 / 0944.887.829 / 0944 887 829. */
const CHAT_PHONE_RE = /(?:\+?84|0)(?:[.\s-]?\d){8,10}/;
function stripChatPhones(text) {
  return text.replace(/(?:^|[\s,;:\-])(?:\+?84|0)(?:[.\s-]?\d){8,10}(?=[\s,;:\-|]|$)/g, ' ');
}

/** Chuẩn hóa tin chat: bỏ SĐT/tên đầu, đổi «A - B - C» thành dấu phẩy, tách ghi chú (...). */
function normalizeChatAddressQuery(raw) {
  const source = String(raw || '').replace(/\u00a0/g, ' ');
  const chatMeta = CHAT_PHONE_RE.test(source) || source.includes('|');
  let text = source;
  const notes = [];
  text = text.replace(/\(([^)]{2,120})\)/g, (_, note) => {
    notes.push(String(note).trim());
    return ', ';
  });
  if (text.includes('|')) text = text.slice(text.lastIndexOf('|') + 1);
  text = stripChatPhones(text);
  if (chatMeta) {
    text = text.replace(
      /^(?!.*(?:phuong|xa|huyen|quan|tinh|thanh pho|tp|thi tran|thi xa)\b)\p{L}+(?:\s+\p{L}+){0,3}\s*,\s*/iu,
      '',
    );
  }
  text = text.replace(/\s*[-–—]\s*/g, ', ');
  text = stripChatPhones(text);
  text = repairAdminLabelTypos(text);
  // Mở P./Q. trước khi «Âu Cơ .P.Tân» bị tách thành «P, Tân».
  text = expandWardDistrictShortcuts(text);
  // «Sơn.Ngũ Lão» / «Lão . Thuỷ» → phẩy; không đụng số nhà (12.5) hay P.5 đã mở.
  text = text.replace(/(?<=\p{L})\s*\.\s*(?=\p{L})/gu, ', ');
  text = text
    .replace(/^(?:đc|dc|địa\s*chỉ|dia\s*chi)\s*[:：-]?\s*/i, '')
    // Nhãn SĐT còn sót: «… tphcm đt» / «… dt».
    .replace(/\b(?:đt|dt|sđt|sdt)\b/gi, ' ')
    .replace(/[|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+\p{L}\s*$/u, '')
    .replace(/^[,.\s]+|[,.\s]+$/g, '')
    .trim();
  return { text, notes };
}

/** Piece sau còn tỉnh/huyện/xã → «dương tơ» phía trước nhiều khả năng là tên xã, không phải đường. */
function laterPiecesSuggestAdmin(pieces, fromIndex, provinceBares, expand = (token) => [token]) {
  for (let index = fromIndex + 1; index < pieces.length; index += 1) {
    const folded = loose(pieces[index] || '');
    if (!folded || /^\d/.test(folded)) continue;
    if (provinceBares.has(stripProvince(folded))) return true;
    if (/^(?:tinh|thanh pho|tp|huyen|quan|thi xa|phuong|xa|thi tran)\b/.test(folded)) return true;
    // Expand alias dính chữ: «phuquoc»/«kiengiang» → 2+ token.
    const toks = wordTokens(folded).flatMap((token) => [...expand(token)]);
    const bare = toks.join(' ');
    if (provinceBares.has(stripProvince(bare))) return true;
    if (
      toks.length >= 2 &&
      toks.length <= 4 &&
      !/^(?:ms|mr|mrs|miss|chi|anh|em|co|chu|bac)\b/.test(folded)
    ) {
      return true;
    }
  }
  return false;
}

function prepareQuery(raw, provinceBares, placeSplits) {
  const provinceCompacts = buildProvinceCompactAliases(provinceBares);
  const expand = (token) => expandAlias(token, provinceCompacts, placeSplits);
  const normalized = normalizeChatAddressQuery(raw);
  const marked = normalized.text.replace(/\s+(?=(?:xã|phường|thị trấn|huyện|quận|thị xã|thành phố|tỉnh)\s+)/giu, ', ');
  const pieces = marked
    .split(/[,;\n]+/)
    .map((piece) => piece.trim())
    .filter(Boolean);
  const wardTokens = [];
  const looseTokens = [];
  const districtTokens = [];
  const provinceTokens = [];
  const street = [...normalized.notes];

  const pushProvinceOrLoose = (tokens, labeledProvince) => {
    const bare = tokens.join(' ');
    // D6: «hưng yên» vừa là tỉnh vừa là xã cũ — khi còn piece khác, để loose để khớp liền mạch.
    if (provinceBares.has(bare) && (labeledProvince || pieces.length === 1)) {
      provinceTokens.push(...tokens);
    } else {
      looseTokens.push(...tokens);
    }
  };

  const cleanStreetPiece = (value) =>
    value.replace(/^(?:đc|dc|địa\s*chỉ|dia\s*chi)\s*[:：-]?\s*/i, '').trim() || value;

  // «923A, Âu Cơ, Phường Tân Sơn Nhì…» — cụm trước nhãn xã/huyện là số nhà/đường.
  // Không lấy «tỉnh/thành phố» làm mốc: tránh nuốt «… xuân thới sơn hóc môn, thành phố HCM».
  const firstAdminAt = pieces.findIndex((piece) =>
    /^(?:phuong|xa|thi tran|huyen|quan|thi xa)\b/.test(loose(piece)),
  );

  for (let pieceIndex = 0; pieceIndex < pieces.length; pieceIndex += 1) {
    const piece = pieces[pieceIndex];
    const folded = loose(piece);
    if (!folded) continue;
    const pieceTokens = wordTokens(folded);
    const hasAdminLabel = /\b(?:phuong|xa|thi tran|huyen|quan|thi xa|tinh|thanh pho|tp)\b/.test(folded);
    // Chỉ nhãn đứng đầu cụm — tránh «nghe tinh» (đường) bị coi là có «tỉnh».
    const hasLeadingAdmin = /^(?:phuong|xa|thi tran|huyen|quan|thi xa|tinh|thanh pho|tp)\b/.test(folded);
    const hasHamlet = /\b(?:thon|xom|ap)\b/.test(folded);
    const startsStreet = /^(?:xom|thon|ap|to|khu|so|duong|pho|ngo|hem|ke|gan|nha|dc|dia chi)\b/.test(folded);

    if (firstAdminAt >= 0 && pieceIndex < firstAdminAt && !hasLeadingAdmin) {
      street.push(cleanStreetPiece(piece));
      continue;
    }

    // «38/27a bình trị đông bình tân tphcm» — không nuốt cả câu vì bắt đầu bằng số.
    if (/^\d/.test(folded)) {
      if (pieceTokens.length <= 4) {
        street.push(cleanStreetPiece(piece));
        continue;
      }
      const peeled = peelLeadingStreetTokens(pieceTokens.flatMap(expand));
      if (peeled.rest.length < 2) {
        street.push(cleanStreetPiece(piece));
        continue;
      }
      const rawWords = piece.trim().split(/\s+/).filter(Boolean);
      street.push(rawWords.slice(0, peeled.street.length).join(' ') || peeled.street.join(' '));
      pushProvinceOrLoose([...peeled.rest], false);
      continue;
    }

    // C1/C5: cụm ngắn số nhà. C2: cụm dài có ấp + tên chỗ sau → peel, không nuốt cả câu.
    // «dương tơ» (xã) ≠ «đường …»: chỉ nuốt street khi ghi rõ «đường/phố» hoặc không có tỉnh/huyện sau.
    if ((startsStreet || hasHamlet) && !hasAdminLabel) {
      const explicitStreetLabel = /^(?:đường|phố)\b/i.test(piece.trim());
      const maybeWardNamedDuongPho =
        !explicitStreetLabel &&
        /^(?:duong|pho)\b/.test(folded) &&
        pieceTokens.length >= 2 &&
        pieceTokens.length <= 3 &&
        laterPiecesSuggestAdmin(pieces, pieceIndex, provinceBares, expand);
      if (maybeWardNamedDuongPho) {
        pushProvinceOrLoose(pieceTokens.flatMap(expand), false);
        continue;
      }
      if (pieceTokens.length <= 4) {
        street.push(cleanStreetPiece(piece));
        continue;
      }
      const peeled = peelLeadingStreetTokens(pieceTokens.flatMap(expand));
      if (peeled.rest.length < 2) {
        street.push(cleanStreetPiece(piece));
        continue;
      }
      const rawWords = piece.trim().split(/\s+/).filter(Boolean);
      street.push(rawWords.slice(0, peeled.street.length).join(' ') || peeled.street.join(' '));
      pushProvinceOrLoose([...peeled.rest], false);
      continue;
    }

    if ((startsStreet || hasHamlet) && hasAdminLabel && pieceTokens.length <= 4) {
      street.push(cleanStreetPiece(piece));
      continue;
    }

    if (/^(?:phuong|xa|thi tran)\b/.test(folded)) {
      wardTokens.push(...wordTokens(stripWard(folded)).flatMap(expand));
      continue;
    }
    if (/^(?:huyen|quan|thi xa)\b/.test(folded)) {
      districtTokens.push(...wordTokens(stripDistrict(folded)).flatMap(expand));
      continue;
    }
    if (/^tinh\b/.test(folded)) {
      provinceTokens.push(...wordTokens(stripProvince(folded)).flatMap(expand));
      continue;
    }
    if (/^(?:thanh pho|tp)\b/.test(folded)) {
      const bare = stripProvince(folded);
      const tokens = wordTokens(bare).flatMap(expand);
      if (provinceBares.has(bare)) provinceTokens.push(...tokens);
      else districtTokens.push(...tokens);
      continue;
    }
    const bare = stripProvince(stripDistrict(stripWard(folded)));
    let tokens = wordTokens(bare).flatMap(expand);
    if (pieceTokens.length >= 5) {
      const peeled = peelLeadingStreetTokens(tokens);
      if (peeled.street.length > 0 && peeled.rest.length >= 2) {
        const rawWords = piece.trim().split(/\s+/).filter(Boolean);
        street.push(rawWords.slice(0, peeled.street.length).join(' ') || peeled.street.join(' '));
        tokens = [...peeled.rest];
      }
    }
    pushProvinceOrLoose(tokens, false);
  }

  return {
    tokens: repairTruncatedProvince(
      [...wardTokens, ...looseTokens, ...districtTokens, ...provinceTokens],
      provinceBares,
    ),
    line: street.join(', '),
  };
}

/** Gỡ token kiểu ấp/số nhà ở đầu cụm dài, giữ lại xã–huyện–tỉnh. */
function peelLeadingStreetTokens(tokens) {
  const street = [];
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (isStreetToken(token) || /^(?:ap|thon|xom|to|khu|lo|hem|ngo|duong|pho|so)$/.test(token)) {
      street.push(token);
      index += 1;
      continue;
    }
    if (/^\d/.test(token) && street.length > 0) {
      street.push(token);
      index += 1;
      continue;
    }
    break;
  }
  if (index === 0) return { street: [], rest: tokens.slice() };
  return { street, rest: tokens.slice(index) };
}

function indexOfSlice(hay, needle) {
  if (!needle.length || needle.length > hay.length) return null;
  let best = null;
  for (let index = 0; index <= hay.length - needle.length; index += 1) {
    let cost = 0;
    let ok = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      const step = tokenMatchCost(hay[index + offset], needle[offset]);
      if (!Number.isFinite(step)) {
        ok = false;
        break;
      }
      cost += step;
    }
    if (!ok) continue;
    if (!best || cost < best.cost) best = { at: index, cost };
    if (cost === 0) break;
  }
  return best;
}

function isStreetToken(token) {
  if (!token || token.length <= 1 || /^\d/.test(token)) return true;
  // Không gồm «chi» — tránh nuốt tiền tố Chí Thạnh; «địa chỉ» đã strip ở normalize.
  return /^(?:dc|dia|nha|van|hoa|thon|xom|ap|to|khu|so|duong|pho|ngo|hem|ke|gan|con|pheo|lo)$/.test(token);
}

/** Token chỉ là nhãn hành chính còn sót (xa/quan/…) — không phải tên chỗ. */
function isAdminLabelToken(token) {
  return /^(?:xa|phuong|quan|huyen|tinh|tp|thi|tran|thanh|pho)$/.test(token);
}

function restCovered(rest, district, province) {
  if (!rest.length) return true;
  const cover = [...district, ...province];
  if (province.length > 0) {
    const provinceHit = province.some((token) => tokensInclude(rest, token));
    if (provinceHit && !province.every((token) => tokensInclude(rest, token))) return false;
  }
  if (district.length > 0) {
    const districtHit = district.some((token) => tokensInclude(rest, token));
    if (districtHit && !district.every((token) => tokensInclude(rest, token))) return false;
  }
  if (!cover.length) return true;
  // Giữ số (P.5/Q.8); bỏ nhiễu đường + nhãn hành chính còn sót (quan/huyen…).
  const placeRest = rest.filter(
    (token) => (!isStreetToken(token) || /^\d+$/.test(token)) && !isAdminLabelToken(token),
  );
  // «P. Tân Sơn Nhì, Q. Tân Phú» không ghi HCM: phần còn lại chỉ cần ⊆ huyện∪tỉnh.
  if (placeRest.length === 0) return true;
  if (placeRest.every((token) => tokensInclude(cover, token))) return true;
  const sameSet =
    cover.every((token) => tokensInclude(rest, token)) && rest.every((token) => tokensInclude(cover, token));
  return indexOfSlice(cover, rest) !== null || sameSet || cover.every((token) => tokensInclude(rest, token));
}

function sumTokenIncludeCosts(hay, needles) {
  let sum = 0;
  for (const needle of needles) {
    const cost = tokensIncludeCost(hay, needle);
    if (!Number.isFinite(cost)) return null;
    sum += cost;
  }
  return sum;
}

function entryProvinceSets(entry) {
  const alt = entry.altProvinceTokens || [];
  if (!alt.length) return [entry.provinceTokens];
  return [entry.provinceTokens, alt];
}

function provinceFullyIn(hay, entry) {
  return entryProvinceSets(entry).some(
    (province) => province.length > 0 && province.every((token) => tokensInclude(hay, token)),
  );
}

function restCoveredForEntry(rest, entry) {
  return entryProvinceSets(entry).some((province) => restCovered(rest, entry.districtTokens, province));
}

function scoreEntry(entry, tokens) {
  if (!entry.wardTokens.length || !tokens.length) return 0;
  const hit = indexOfSlice(tokens, entry.wardTokens);
  let score = 0;
  let rest = [];
  let fuzzyCost = 0;
  if (hit) {
    const before = tokens.slice(0, hit.at);
    const after = tokens.slice(hit.at + entry.wardTokens.length);
    rest = [...before, ...after];
    fuzzyCost = hit.cost;
    const beforeHasPlace = before.some((token) => !isStreetToken(token));
    if (beforeHasPlace) {
      // Chấp nhận tỉnh mới (alt) khi chat ghi An Giang thay vì Kiên Giang cũ.
      if (!provinceFullyIn(after, entry)) return 0;
      if (!restCoveredForEntry(rest, entry)) return 0;
      return 850 + entry.wardTokens.length * 10 + (entry.kind === 'old' ? 5 : 0) - fuzzyCost * FUZZY_COST_PER_EDIT;
    }
    score = 1000 + entry.wardTokens.length * 10 + (entry.kind === 'old' ? 5 : 0);
  } else {
    // Query là đoạn liên tiếp trong tên xã dài hơn: «long thành» ⊂ «long thành bắc».
    const wardHit = indexOfSlice(entry.wardTokens, tokens);
    if (!wardHit || entry.wardTokens.length <= tokens.length) return 0;
    const prefix = wardHit.at === 0;
    fuzzyCost = wardHit.cost;
    score = (prefix ? 920 : 860) + tokens.length * 15 + (entry.kind === 'old' ? 5 : 0);
    rest = [];
  }
  if (!restCoveredForEntry(rest, entry)) return 0;
  // Soft tên xã cần tỉnh (hoặc huyện) trong câu — tránh «tan thanh» ≈ «tan thinh».
  if (fuzzyCost > 0) {
    const districtOk =
      entry.districtTokens.length > 0 && sumTokenIncludeCosts(rest, entry.districtTokens) !== null;
    const provinceOk = entryProvinceSets(entry).some(
      (province) => province.length > 0 && sumTokenIncludeCosts(rest, province) !== null,
    );
    if (!districtOk && !provinceOk) return 0;
  }
  if (rest.length > 0 && entry.districtTokens.length > 0) {
    const districtCost = sumTokenIncludeCosts(rest, entry.districtTokens);
    if (districtCost !== null) score += 200 - districtCost * FUZZY_COST_PER_EDIT;
  }
  if (rest.length > 0) {
    let bestProvince = 0;
    for (const province of entryProvinceSets(entry)) {
      if (!province.length) continue;
      const provinceCost = sumTokenIncludeCosts(rest, province);
      if (provinceCost === null) continue;
      bestProvince = Math.max(bestProvince, 200 - provinceCost * FUZZY_COST_PER_EDIT);
    }
    score += bestProvince;
  }
  return score - fuzzyCost * FUZZY_COST_PER_EDIT;
}

function pickScoredPool(scored, tokenCount) {
  const sorted = scored.slice().sort(
    (a, b) =>
      b.score - a.score ||
      a.entry.oldText.localeCompare(b.entry.oldText, 'vi') ||
      a.entry.newText.localeCompare(b.entry.newText, 'vi'),
  );
  const exact = sorted.filter((item) => item.score >= 1000);
  const wantExpansions = tokenCount > 0 && tokenCount <= 3;
  const destKey = (item) => `${item.entry.provinceCode}:${item.entry.wardCode}`;
  if (!wantExpansions) {
    const pool = exact.length > 0 ? exact : sorted;
    const out = [];
    const seen = new Set();
    for (const item of pool) {
      const key = destKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
      if (out.length >= SEARCH_LIMIT) break;
    }
    return out;
  }
  const expansions = sorted.filter((item) => item.score >= 700 && item.score < 1000);
  const out = [];
  const seen = new Set();
  const push = (item) => {
    const key = destKey(item);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  };
  const reserve = Math.min(EXPANSION_RESERVE, expansions.length);
  for (const item of exact) {
    if (out.length >= SEARCH_LIMIT - reserve) break;
    push(item);
  }
  for (const item of expansions) {
    if (out.length >= SEARCH_LIMIT) break;
    push(item);
  }
  for (const item of sorted) {
    if (out.length >= SEARCH_LIMIT) break;
    push(item);
  }
  return out;
}

function titleCaseVn(value) {
  return String(value || '').replace(/\p{L}+/gu, (word) => word.charAt(0).toLocaleUpperCase('vi') + word.slice(1));
}

function wardBucketKey(province, district) {
  return `${province}\t${district}`;
}

function buildLegacySelectTree(mapping) {
  const provinceNames = new Map();
  const districtNames = new Map();
  const wardNames = new Map();

  for (const key of Object.keys(mapping)) {
    const parts = parseOldAddressKey(key);
    if (!parts) continue;
    const pLoose = loose(parts.province);
    const dLoose = loose(parts.district);
    const wLoose = loose(parts.ward);
    if (!provinceNames.has(pLoose)) provinceNames.set(pLoose, titleCaseVn(parts.province));
    let districts = districtNames.get(pLoose);
    if (!districts) {
      districts = new Map();
      districtNames.set(pLoose, districts);
    }
    if (!districts.has(dLoose)) districts.set(dLoose, titleCaseVn(parts.district));
    const bucket = wardBucketKey(pLoose, dLoose);
    let wards = wardNames.get(bucket);
    if (!wards) {
      wards = new Map();
      wardNames.set(bucket, wards);
    }
    if (!wards.has(wLoose)) wards.set(wLoose, titleCaseVn(parts.ward));
  }

  const provinces = [...provinceNames.values()].sort((a, b) => a.localeCompare(b, 'vi'));
  const districts = {};
  const wards = {};
  for (const [pLoose, pName] of provinceNames) {
    const distMap = districtNames.get(pLoose);
    districts[pName] = distMap ? [...distMap.values()].sort((a, b) => a.localeCompare(b, 'vi')) : [];
    if (!distMap) continue;
    for (const [dLoose, dName] of distMap) {
      const wMap = wardNames.get(wardBucketKey(pLoose, dLoose));
      wards[wardBucketKey(pName, dName)] = wMap
        ? [...wMap.values()].sort((a, b) => a.localeCompare(b, 'vi'))
        : [];
    }
  }
  return { provinces, districts, wards };
}

function createLegacySearcher(mapping, rows) {
  const records = [];
  const provinceBares = new Set();
  /** Cây 3 cấp chỉ cần khi chọn tay — lazy để lần đầu nhận diện địa chỉ nhanh hơn. */
  let treeCache = null;

  // Index tỉnh/xã để build mapping O(n) thay vì quét lại cả danh sách mỗi dòng.
  const provinceByFull = new Map();
  const provinceByShort = new Map();
  for (const row of rows) {
    const item = { code: row[0], name: row[1], wards: row[2] };
    const full = normalizeVn(row[1]);
    const short = stripProvince(loose(row[1]));
    provinceBares.add(short);
    if (!provinceByFull.has(full)) provinceByFull.set(full, item);
    if (!provinceByShort.has(short)) provinceByShort.set(short, item);
    const wardByFull = new Map();
    const wardByShort = new Map();
    for (const [wardCode, wardName] of row[2]) {
      wardByFull.set(normalizeVn(wardName), { code: wardCode, name: wardName });
      wardByShort.set(stripWard(loose(wardName)), { code: wardCode, name: wardName });
      records.push({
        kind: 'current',
        wardTokens: wordTokens(stripWard(loose(wardName))),
        districtTokens: [],
        provinceTokens: wordTokens(short),
        altProvinceTokens: [],
        oldText: '',
        newText: `${abbreviateAdminLabel(wardName)} · ${abbreviateAdminLabel(row[1])}`,
        provinceCode: row[0],
        wardCode,
        provinceName: row[1],
        wardName,
      });
    }
    item.wardByFull = wardByFull;
    item.wardByShort = wardByShort;
  }

  function resolveProvince(provinceName) {
    const full = normalizeVn(provinceName);
    const short = stripProvince(loose(provinceName));
    if (provinceByFull.has(full)) return provinceByFull.get(full);
    if (provinceByShort.has(short)) return provinceByShort.get(short);
    return findProvince(rows, provinceName);
  }

  function resolveWard(province, wardName) {
    if (!province) return null;
    const full = normalizeVn(wardName);
    const short = stripWard(loose(wardName));
    if (province.wardByFull?.has(full)) return province.wardByFull.get(full);
    if (province.wardByShort?.has(short)) return province.wardByShort.get(short);
    return findWard(province.wards, wardName);
  }

  for (const [key, value] of Object.entries(mapping)) {
    const parsed = parseOldAddressKey(key);
    const next = splitNewAddress(value);
    if (!parsed || !next) continue;
    const province = resolveProvince(next.province);
    const ward = resolveWard(province, next.ward);
    if (!province || !ward) continue;
    const oldProvinceTokens = wordTokens(stripProvince(loose(parsed.province)));
    const newProvinceTokens = wordTokens(stripProvince(loose(next.province)));
    const sameProvince =
      oldProvinceTokens.length === newProvinceTokens.length &&
      oldProvinceTokens.every((token, index) => token === newProvinceTokens[index]);
    records.push({
      kind: 'old',
      wardTokens: wordTokens(stripWard(loose(parsed.ward))),
      districtTokens: wordTokens(stripDistrict(loose(parsed.district))),
      provinceTokens: oldProvinceTokens,
      altProvinceTokens: sameProvince ? [] : newProvinceTokens,
      oldText: `${abbreviateAdminLabel(parsed.ward)} · ${abbreviateAdminLabel(parsed.district)} · ${abbreviateAdminLabel(parsed.province)}`,
      newText: `${abbreviateAdminLabel(next.ward)} · ${abbreviateAdminLabel(next.province)}`,
      provinceCode: province.code,
      wardCode: ward.code,
      provinceName: province.name,
      wardName: ward.name,
    });
  }

  const placeSplits = buildPlaceCompactSplits(records);

  function resolveManual(selection) {
    const p = loose(selection?.province);
    const d = loose(selection?.district);
    const w = loose(selection?.ward);
    if (!p || !d || !w) return null;
    for (const [key, value] of Object.entries(mapping)) {
      const parsed = parseOldAddressKey(key);
      if (!parsed) continue;
      if (loose(parsed.province) !== p || loose(parsed.district) !== d || loose(parsed.ward) !== w) continue;
      const next = splitNewAddress(value);
      if (!next) return null;
      const province = resolveProvince(next.province);
      const ward = resolveWard(province, next.ward);
      if (!province || !ward) return null;
      return {
        oldText: `${abbreviateAdminLabel(parsed.ward)} · ${abbreviateAdminLabel(parsed.district)} · ${abbreviateAdminLabel(parsed.province)}`,
        newText: `${abbreviateAdminLabel(next.ward)} · ${abbreviateAdminLabel(next.province)}`,
        provinceCode: province.code,
        wardCode: ward.code,
        provinceName: province.name,
        wardName: ward.name,
        line: '',
      };
    }
    return null;
  }

  return {
    size: records.length,
    get tree() {
      if (!treeCache) treeCache = buildLegacySelectTree(mapping);
      return treeCache;
    },
    resolveManual,
    search(query) {
      const prepared = prepareQuery(query, provinceBares, placeSplits);
      const compact = prepared.tokens.join('');
      const baseDebug = {
        raw: String(query || ''),
        tokens: prepared.tokens.slice(),
        line: prepared.line,
        compact,
      };
      if (compact.length < 3) {
        return {
          items: [],
          more: false,
          debug: { ...baseDebug, itemCount: 0, top: [], reason: 'tokens-too-short' },
        };
      }

      const scored = [];
      for (const entry of records) {
        const score = scoreEntry(entry, prepared.tokens);
        if (score <= 0) continue;
        if (compact.length < 4 && score < 1000) continue;
        scored.push({ entry, score });
      }
      const pool = pickScoredPool(scored, prepared.tokens.length);
      const top = scored
        .slice()
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((item) => ({
          score: item.score,
          oldText: item.entry.oldText,
          newText: item.entry.newText,
        }));
      return {
        items: pool.map((item) => ({
          oldText: item.entry.oldText,
          newText: item.entry.newText,
          provinceCode: item.entry.provinceCode,
          wardCode: item.entry.wardCode,
          provinceName: item.entry.provinceName,
          wardName: item.entry.wardName,
          line: prepared.line,
        })),
        more: scored.length > pool.length,
        debug: {
          ...baseDebug,
          itemCount: pool.length,
          top,
          reason: pool.length === 0 ? 'no-score' : undefined,
        },
      };
    },
  };
}

globalThis.createLegacySearcher = createLegacySearcher;
