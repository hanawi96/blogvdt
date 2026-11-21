import { foldAddressText, type AddressSelectRow } from './parse';

export type LegacySuggestion = {
  /** Địa chỉ 3 cấp cũ. Rỗng nếu dòng là xã mới. */
  oldText: string;
  newText: string;
  provinceCode: string;
  wardCode: string;
  /** Xóm, thôn, số nhà tách khỏi câu tìm. Rỗng thì giữ ô số nhà đang có. */
  line: string;
};

export type LegacySearchDebug = {
  raw: string;
  tokens: string[];
  line: string;
  compact: string;
  itemCount: number;
  top: { score: number; oldText: string; newText: string }[];
  reason?: string;
};

export type LegacySearchResult = {
  items: LegacySuggestion[];
  more: boolean;
  debug: LegacySearchDebug;
};

type Entry = {
  kind: 'old' | 'current';
  wardTokens: readonly string[];
  districtTokens: readonly string[];
  /** Tỉnh theo key cũ (3 cấp). */
  provinceTokens: readonly string[];
  /**
   * Tỉnh đơn vị mới sau sáp nhập — chat hay ghi tỉnh mới (vd. An Giang)
   * trong khi bản ghi cũ vẫn là Kiên Giang.
   */
  altProvinceTokens: readonly string[];
  oldText: string;
  newText: string;
  provinceCode: string;
  wardCode: string;
};

const ALIAS_TOKENS: Readonly<Record<string, readonly string[]>> = {
  hcm: ['ho', 'chi', 'minh'],
  tphcm: ['ho', 'chi', 'minh'],
  sg: ['ho', 'chi', 'minh'],
  hn: ['ha', 'noi'],
  dn: ['da', 'nang'],
};

/** Typo hẹp cao nguyên / tên dễ viết sai (so khớp token, không thay query). */
const SOFT_TOKEN_EQ: Readonly<Record<string, readonly string[]>> = {
  than: ['thanh'],
  thanh: ['than'],
};

/** Số gợi ý tối đa; ưu tiên đủ (exact + tên dài hơn chứa query). */
const LIMIT = 20;
/** Giữ chỗ cho xã/phường dài hơn khi query là tiền tố (vd «long thành» → «long thành bắc»). */
const EXPANSION_RESERVE = 8;

let cachedRows: readonly AddressSelectRow[] | null = null;
let cachedMapping: Readonly<Record<string, string>> | null = null;
let cachedEntries: Entry[] | null = null;
let cachedPlaceSplits: ReadonlyMap<string, readonly string[]> | null = null;

/** Bỏ gạch ngang và dấu nháy để «Cam Ly - Đà Lạt» khớp «Cam Ly-Đà Lạt». */
function loose(value: string): string {
  return foldAddressText(value)
    .replace(/[-–—'’']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripWard(text: string): string {
  return text.replace(/^(?:phuong|xa|thi tran|thi xa)\s+/, '').trim();
}

function stripDistrict(text: string): string {
  return text.replace(/^(?:huyen|quan|thi xa|thanh pho|thi tran)\s+/, '').trim();
}

function stripProvince(text: string): string {
  return text.replace(/^(?:tinh|thanh pho|tp)\s+/, '').trim();
}

function wordTokens(text: string): string[] {
  return text.split(' ').filter((token) => token.length > 0);
}

function displayName(value: string): string {
  return value.replace(/\p{L}+/gu, (word) => word.charAt(0).toLocaleUpperCase('vi') + word.slice(1));
}

/**
 * Tách khóa cũ theo chữ «tỉnh / huyện / quận», không cắt mọi dấu gạch.
 * «Phan Rang-Tháp Chàm» và «Bà Rịa - Vũng Tàu» vẫn nằm trong một cấp.
 */
function splitOldKey(key: string): { ward: string; district: string; province: string } | null {
  const raw = key.trim();
  const lower = raw.toLowerCase();
  const provAt = Math.max(lower.lastIndexOf('-tỉnh '), lower.lastIndexOf('-thành phố '));
  if (provAt < 1) return null;
  const province = raw.slice(provAt + 1).trim();
  const head = raw.slice(0, provAt);
  const headLower = head.toLowerCase();
  const distAt = Math.max(
    headLower.lastIndexOf('-huyện '),
    headLower.lastIndexOf('-quận '),
    headLower.lastIndexOf('-thị xã '),
    headLower.lastIndexOf('-thành phố '),
    headLower.lastIndexOf('-thị trấn '),
  );
  if (distAt < 1) return null;
  const district = head.slice(distAt + 1).trim();
  const ward = head.slice(0, distAt).trim();
  if (!ward || !district || !province) return null;
  return { ward, district, province };
}

function splitNewValue(value: string): { ward: string; province: string } | null {
  const raw = value.trim();
  const lower = raw.toLowerCase();
  const at = Math.max(lower.lastIndexOf('-tỉnh '), lower.lastIndexOf('-thành phố '));
  if (at < 1) return null;
  const ward = raw.slice(0, at).trim();
  const province = raw.slice(at + 1).trim();
  if (!ward || !province) return null;
  return { ward, province };
}

function buildWardLookup(rows: readonly AddressSelectRow[]): Map<string, { provinceCode: string; wardCode: string } | 'ambiguous'> {
  const lookup = new Map<string, { provinceCode: string; wardCode: string } | 'ambiguous'>();
  for (const [provinceCode, provinceName, wards] of rows) {
    const provinceBare = stripProvince(loose(provinceName));
    for (const [wardCode, wardName] of wards) {
      const key = `${stripWard(loose(wardName))}|${provinceBare}`;
      const hit = { provinceCode, wardCode };
      const prev = lookup.get(key);
      if (!prev) lookup.set(key, hit);
      else if (prev !== 'ambiguous' && (prev.provinceCode !== hit.provinceCode || prev.wardCode !== hit.wardCode)) {
        lookup.set(key, 'ambiguous');
      }
    }
  }
  return lookup;
}

function entriesFrom(rows: readonly AddressSelectRow[], mapping: Readonly<Record<string, string>>): Entry[] {
  const lookup = buildWardLookup(rows);
  const entries: Entry[] = [];
  const seenCurrent = new Set<string>();

  for (const [provinceCode, provinceName, wards] of rows) {
    const provinceTokens = wordTokens(stripProvince(loose(provinceName)));
    for (const [wardCode, wardName] of wards) {
      const id = `${provinceCode}:${wardCode}`;
      if (seenCurrent.has(id)) continue;
      seenCurrent.add(id);
      entries.push({
        kind: 'current',
        wardTokens: wordTokens(stripWard(loose(wardName))),
        districtTokens: [],
        provinceTokens,
        altProvinceTokens: [],
        oldText: '',
        newText: `${wardName} · ${provinceName}`,
        provinceCode,
        wardCode,
      });
    }
  }

  for (const [key, value] of Object.entries(mapping)) {
    const oldParts = splitOldKey(key);
    const next = splitNewValue(value);
    if (!oldParts || !next) continue;
    const resolved = lookup.get(`${stripWard(loose(next.ward))}|${stripProvince(loose(next.province))}`);
    if (!resolved || resolved === 'ambiguous') continue;
    const oldProvinceTokens = wordTokens(stripProvince(loose(oldParts.province)));
    const newProvinceTokens = wordTokens(stripProvince(loose(next.province)));
    const sameProvince =
      oldProvinceTokens.length === newProvinceTokens.length &&
      oldProvinceTokens.every((token, index) => token === newProvinceTokens[index]);
    entries.push({
      kind: 'old',
      wardTokens: wordTokens(stripWard(loose(oldParts.ward))),
      districtTokens: wordTokens(stripDistrict(loose(oldParts.district))),
      provinceTokens: oldProvinceTokens,
      altProvinceTokens: sameProvince ? [] : newProvinceTokens,
      oldText: `${displayName(oldParts.ward)} · ${displayName(oldParts.district)} · ${displayName(oldParts.province)}`,
      newText: `${next.ward} · ${next.province}`,
      provinceCode: resolved.provinceCode,
      wardCode: resolved.wardCode,
    });
  }

  return entries;
}

function indexEntries(rows: readonly AddressSelectRow[], mapping: Readonly<Record<string, string>>): Entry[] {
  if (cachedEntries && cachedRows === rows && cachedMapping === mapping) return cachedEntries;
  cachedRows = rows;
  cachedMapping = mapping;
  cachedEntries = entriesFrom(rows, mapping);
  cachedPlaceSplits = buildPlaceCompactSplits(cachedEntries);
  return cachedEntries;
}

export function legacyCoverage(
  rows: readonly AddressSelectRow[],
  mapping: Readonly<Record<string, string>>,
): { old: number; current: number } {
  const entries = indexEntries(rows, mapping);
  let old = 0;
  let current = 0;
  for (const entry of entries) {
    if (entry.kind === 'old') old += 1;
    else current += 1;
  }
  return { old, current };
}

type PreparedQuery = {
  tokens: string[];
  line: string;
  provinceBares: ReadonlySet<string>;
};

/** «đắklắk» → dak+lak; «dakla» (cắt 1–2 ký tự) nếu chỉ khớp một tỉnh. */
function buildProvinceCompactAliases(provinceBares: ReadonlySet<string>): Map<string, readonly string[]> {
  const map = new Map<string, readonly string[]>();
  const prefixes = new Map<string, readonly string[] | null>();
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
function repairTruncatedProvince(tokens: readonly string[], provinceBares: ReadonlySet<string>): string[] {
  const out = [...tokens];
  let best: { start: number; parts: string[] } | null = null;
  for (const bare of provinceBares) {
    const parts = wordTokens(bare);
    if (parts.length < 2 || parts.length > out.length) continue;
    const start = out.length - parts.length;
    let ok = true;
    let truncated = false;
    for (let i = 0; i < parts.length; i += 1) {
      const query = out[start + i]!;
      const part = parts[i]!;
      if (query === part) continue;
      if (i === parts.length - 1 && part.startsWith(query) && query.length >= 2 && query.length < part.length) {
        truncated = true;
        continue;
      }
      ok = false;
      break;
    }
    if (!ok || !truncated) continue;
    if (best) return [...tokens];
    best = { start, parts };
  }
  if (!best) return out;
  return [...out.slice(0, best.start), ...best.parts];
}

/** «pongdrang» → pong+drang, «krongbuk» → krong+buk khi cụm dính đúng một cách tách. */
function buildPlaceCompactSplits(entries: readonly Entry[]): Map<string, readonly string[]> {
  const seen = new Map<string, readonly string[] | null>();
  const add = (parts: readonly string[]) => {
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
  const out = new Map<string, readonly string[]>();
  for (const [compact, parts] of seen) {
    if (parts) out.set(compact, parts);
  }
  return out;
}

function expandAlias(
  token: string,
  provinceCompacts?: ReadonlyMap<string, readonly string[]>,
  placeSplits?: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
  if (ALIAS_TOKENS[token]) return ALIAS_TOKENS[token];
  const fromProvince = provinceCompacts?.get(token);
  if (fromProvince) return fromProvince;
  const fromPlace = placeSplits?.get(token);
  if (fromPlace) return fromPlace;
  // Typo thiếu/thừa 1 ký tự trên tên dính: «pongdran» → pong+drang.
  // Chỉ insert/delete (|len| lệch 1) — không thay thế cùng dài (tránh nguyen ≈ ngayen).
  if (placeSplits && token.length >= 6) {
    let best: { parts: readonly string[]; cost: number } | null = null;
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

function maxAllowedTokenDistance(leftLen: number, rightLen: number): number {
  const maxLen = Math.max(leftLen, rightLen);
  const delta = Math.abs(leftLen - rightLen);
  if (maxLen >= 8 && delta <= 2) return 2;
  if (maxLen >= 5 && delta <= 1) return 1;
  return 0;
}

/** Levenshtein có trần; trả -1 nếu chắc chắn vượt maxDist. */
function tokenEditDistance(a: string, b: string, maxDist: number): number {
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
    let rowMin = curr[0]!;
    const aCh = a[i - 1]!;
    for (let j = 1; j <= bLen; j += 1) {
      const cost = aCh === b[j - 1] ? 0 : 1;
      const value = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
      curr[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > maxDist) return -1;
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  const dist = prev[bLen]!;
  return dist <= maxDist ? dist : -1;
}

/**
 * 0 = exact / SOFT_TOKEN_EQ; 1–2 = soft typo; Infinity = không khớp.
 * Token ngắn (<5) không soft; cùng ký tự đầu khi soft.
 */
function tokenMatchCost(left: string, right: string): number {
  if (left === right) return 0;
  const soft = SOFT_TOKEN_EQ[left];
  if (soft?.includes(right)) return 0;
  if (!left || !right || left[0] !== right[0]) return Number.POSITIVE_INFINITY;
  const allowed = maxAllowedTokenDistance(left.length, right.length);
  if (allowed === 0) return Number.POSITIVE_INFINITY;
  const dist = tokenEditDistance(left, right, allowed);
  if (dist < 0) return Number.POSITIVE_INFINITY;
  return dist;
}

function tokensEqual(left: string, right: string): boolean {
  return Number.isFinite(tokenMatchCost(left, right));
}

function tokensIncludeCost(hay: readonly string[], needle: string): number {
  let best = Number.POSITIVE_INFINITY;
  for (const token of hay) {
    const cost = tokenMatchCost(token, needle);
    if (cost < best) best = cost;
  }
  return best;
}

function tokensInclude(hay: readonly string[], needle: string): boolean {
  return Number.isFinite(tokensIncludeCost(hay, needle));
}

/**
 * Sửa typo nhãn hành chính hay gặp trong chat (tình→tỉnh, huyên→huyện…).
 * Chỉ khi đứng như từ riêng trước tên chỗ — tránh đụng tên đường hiếm.
 */
const ASCII_ADMIN_LABELS: Readonly<Record<string, string>> = {
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
function repairAdminLabelTypos(text: string): string {
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
    (full, pre: string, label: string) => {
      const key = label.toLowerCase().replace(/\s+/g, ' ');
      const fixed = ASCII_ADMIN_LABELS[key];
      return fixed ? `${pre}${fixed}` : full;
    },
  );
  return out;
}

/**
 * p5 / P.5 / ph 14 → Phường N; Q8 / q.8 → Quận N.
 * P.Tân / Q.Tân / X.Tráng / H.Mê / TT. / TX. / TP. — mở nhãn đầy đủ trước khi đổi dấu chấm thành phẩy.
 * Quận 1–12 mà chưa có tỉnh → thêm TP.HCM (quận số hầu hết thuộc HCM).
 */
function expandWardDistrictShortcuts(text: string): string {
  let out = String(text || '');
  // Không mở khi dính chữ liền trước (tránh «ấp» + «p5» kiểu biên ASCII \b).
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
function stripChatPhones(text: string): string {
  return text.replace(/(?:^|[\s,;:\-])(?:\+?84|0)(?:[.\s-]?\d){8,10}(?=[\s,;:\-|]|$)/g, ' ');
}

/** Chuẩn hóa tin chat: bỏ SĐT/tên đầu, đổi «A - B - C» thành dấu phẩy, tách ghi chú (...). */
function normalizeChatAddressQuery(raw: string): { text: string; notes: string[] } {
  const source = String(raw || '').replace(/\u00a0/g, ' ');
  const chatMeta = CHAT_PHONE_RE.test(source) || source.includes('|');
  let text = source;
  const notes: string[] = [];
  text = text.replace(/\(([^)]{2,120})\)/g, (_, note: string) => {
    notes.push(note.trim());
    return ', ';
  });
  if (text.includes('|')) text = text.slice(text.lastIndexOf('|') + 1);
  text = stripChatPhones(text);
  // Chỉ bỏ họ tên đầu khi tin có SĐT hoặc dấu | — tránh nuốt «xã Tân…,».
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
    // Ký tự đơn cuối kiểu «Hải Phòng b» thường là nhiễu chat.
    .replace(/\s+\p{L}\s*$/u, '')
    .replace(/^[,.\s]+|[,.\s]+$/g, '')
    .trim();
  return { text, notes };
}

/** Piece sau còn tỉnh/huyện/xã → «dương tơ» phía trước nhiều khả năng là tên xã, không phải đường. */
function laterPiecesSuggestAdmin(
  pieces: readonly string[],
  fromIndex: number,
  provinceBares: ReadonlySet<string>,
): boolean {
  for (let index = fromIndex + 1; index < pieces.length; index += 1) {
    const folded = loose(pieces[index] || '');
    if (!folded || /^\d/.test(folded)) continue;
    if (provinceBares.has(stripProvince(folded))) return true;
    if (/^(?:tinh|thanh pho|tp|huyen|quan|thi xa|phuong|xa|thi tran)\b/.test(folded)) return true;
    // Tỉnh/huyện cũ đã sáp nhập (Kiên Giang) hoặc TP đảo (Phú Quốc) — không còn trong provinceBares.
    const toks = wordTokens(folded);
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

function prepareQuery(
  raw: string,
  provinceBares: ReadonlySet<string>,
  placeSplits?: ReadonlyMap<string, readonly string[]>,
): PreparedQuery {
  const provinceCompacts = buildProvinceCompactAliases(provinceBares);
  const expand = (token: string) => expandAlias(token, provinceCompacts, placeSplits);
  const normalized = normalizeChatAddressQuery(raw);
  const marked = normalized.text.replace(/\s+(?=(?:xã|phường|thị trấn|huyện|quận|thị xã|thành phố|tỉnh)\s+)/giu, ', ');
  const pieces = marked
    .split(/[,;\n]+/)
    .map((piece) => piece.trim())
    .filter(Boolean);
  const wardTokens: string[] = [];
  const looseTokens: string[] = [];
  const districtTokens: string[] = [];
  const provinceTokens: string[] = [];
  const street: string[] = [...normalized.notes];

  const pushProvinceOrLoose = (tokens: string[], labeledProvince: boolean) => {
    const bare = tokens.join(' ');
    // D6: «hưng yên» vừa là tỉnh vừa là xã cũ — khi còn piece khác, để loose để khớp liền mạch.
    if (provinceBares.has(bare) && (labeledProvince || pieces.length === 1)) {
      provinceTokens.push(...tokens);
    } else {
      looseTokens.push(...tokens);
    }
  };

  const cleanStreetPiece = (value: string) =>
    value.replace(/^(?:đc|dc|địa\s*chỉ|dia\s*chi)\s*[:：-]?\s*/i, '').trim() || value;

  // «923A, Âu Cơ, Phường Tân Sơn Nhì…» — cụm trước nhãn xã/huyện là số nhà/đường.
  // Không lấy «tỉnh/thành phố» làm mốc: tránh nuốt «… xuân thới sơn hóc môn, thành phố HCM».
  const firstAdminAt = pieces.findIndex((piece) =>
    /^(?:phuong|xa|thi tran|huyen|quan|thi xa)\b/.test(loose(piece)),
  );

  for (let pieceIndex = 0; pieceIndex < pieces.length; pieceIndex += 1) {
    const piece = pieces[pieceIndex]!;
    const folded = loose(piece);
    if (!folded) continue;
    const pieceTokens = wordTokens(folded);
    const hasAdminLabel = /\b(?:phuong|xa|thi tran|huyen|quan|thi xa|tinh|thanh pho|tp)\b/.test(folded);
    const hasHamlet = /\b(?:thon|xom|ap)\b/.test(folded);
    const startsStreet = /^(?:xom|thon|ap|to|khu|so|duong|pho|ngo|hem|ke|gan|nha|dc|dia chi)\b/.test(folded);

    if (firstAdminAt >= 0 && pieceIndex < firstAdminAt && !hasAdminLabel) {
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
    // «đc nhà văn hoá thôn còn pheo» (không nhãn xã/tỉnh trong piece) → cả piece là street.
    // «dương tơ» (xã) ≠ «đường …»: chỉ nuốt street khi ghi rõ «đường/phố» hoặc không có tỉnh/huyện sau.
    if ((startsStreet || hasHamlet) && !hasAdminLabel) {
      const explicitStreetLabel = /^(?:đường|phố)\b/i.test(piece.trim());
      const maybeWardNamedDuongPho =
        !explicitStreetLabel &&
        /^(?:duong|pho)\b/.test(folded) &&
        pieceTokens.length >= 2 &&
        pieceTokens.length <= 3 &&
        laterPiecesSuggestAdmin(pieces, pieceIndex, provinceBares);
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
    provinceBares,
  };
}

/** Gỡ token kiểu ấp/số nhà ở đầu cụm dài, giữ lại xã–huyện–tỉnh. */
function peelLeadingStreetTokens(tokens: readonly string[]): { street: string[]; rest: string[] } {
  const street: string[] = [];
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index]!;
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
  if (index === 0) return { street: [], rest: [...tokens] };
  return { street, rest: tokens.slice(index) };
}

function indexOfSlice(
  hay: readonly string[],
  needle: readonly string[],
): { at: number; cost: number } | null {
  if (needle.length === 0 || needle.length > hay.length) return null;
  let best: { at: number; cost: number } | null = null;
  for (let index = 0; index <= hay.length - needle.length; index += 1) {
    let cost = 0;
    let ok = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      const step = tokenMatchCost(hay[index + offset]!, needle[offset]!);
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

function isStreetToken(token: string): boolean {
  if (!token || token.length <= 1 || /^\d/.test(token)) return true;
  // Không gồm «chi» — tránh nuốt tiền tố Chí Thạnh; «địa chỉ» đã strip ở normalize.
  return /^(?:dc|dia|nha|van|hoa|thon|xom|ap|to|khu|so|duong|pho|ngo|hem|ke|gan|con|pheo|lo)$/.test(token);
}

/** Token chỉ là nhãn hành chính còn sót (xa/quan/…) — không phải tên chỗ. */
function isAdminLabelToken(token: string): boolean {
  return /^(?:xa|phuong|quan|huyen|tinh|tp|thi|tran|thanh|pho)$/.test(token);
}

function restCovered(rest: readonly string[], district: readonly string[], province: readonly string[]): boolean {
  if (rest.length === 0) return true;
  const cover = [...district, ...province];
  // Cho phép số nhà/đường còn lại; chỉ bắt buộc đúng huyện/tỉnh nếu chúng xuất hiện trong câu.
  if (province.length > 0) {
    const provinceHit = province.some((token) => tokensInclude(rest, token));
    if (provinceHit && !province.every((token) => tokensInclude(rest, token))) return false;
  }
  if (district.length > 0) {
    const districtHit = district.some((token) => tokensInclude(rest, token));
    if (districtHit && !district.every((token) => tokensInclude(rest, token))) return false;
  }
  if (cover.length === 0) return true;
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

function entryProvinceSets(entry: Entry): readonly (readonly string[])[] {
  if (entry.altProvinceTokens.length === 0) return [entry.provinceTokens];
  return [entry.provinceTokens, entry.altProvinceTokens];
}

function provinceFullyIn(hay: readonly string[], entry: Entry): boolean {
  return entryProvinceSets(entry).some(
    (province) => province.length > 0 && province.every((token) => tokensInclude(hay, token)),
  );
}

function restCoveredForEntry(rest: readonly string[], entry: Entry): boolean {
  return entryProvinceSets(entry).some((province) => restCovered(rest, entry.districtTokens, province));
}

function sumTokenIncludeCosts(hay: readonly string[], needles: readonly string[]): number | null {
  let sum = 0;
  for (const needle of needles) {
    const cost = tokensIncludeCost(hay, needle);
    if (!Number.isFinite(cost)) return null;
    sum += cost;
  }
  return sum;
}

function scoreEntry(entry: Entry, tokens: readonly string[]): number {
  if (entry.wardTokens.length === 0 || tokens.length === 0) return 0;
  const hit = indexOfSlice(tokens, entry.wardTokens);
  let score = 0;
  let rest: string[] = [];
  let fuzzyCost = 0;
  if (hit) {
    const before = tokens.slice(0, hit.at);
    const after = tokens.slice(hit.at + entry.wardTokens.length);
    rest = [...before, ...after];
    fuzzyCost = hit.cost;
    const beforeHasPlace = before.some((token) => !isStreetToken(token));
    if (beforeHasPlace) {
      // «Ngũ Lão, Thuỷ Nguyên, Hải Phòng»: tên cũ/xóm trước phường mới — chỉ nhận khi phần SAU đã đủ tỉnh.
      // Không cộng thưởng huyện/tỉnh (giữ < 1000) để không át khớp xã cũ exact.
      // Chấp nhận tỉnh mới (alt) khi chat ghi An Giang thay vì Kiên Giang cũ.
      if (!provinceFullyIn(after, entry)) return 0;
      if (!restCoveredForEntry(rest, entry)) return 0;
      return 850 + entry.wardTokens.length * 10 + (entry.kind === 'old' ? 5 : 0) - fuzzyCost * FUZZY_COST_PER_EDIT;
    }
    // Khớp đủ tên xã trong query.
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
      if (province.length === 0) continue;
      const provinceCost = sumTokenIncludeCosts(rest, province);
      if (provinceCost === null) continue;
      bestProvince = Math.max(bestProvince, 200 - provinceCost * FUZZY_COST_PER_EDIT);
    }
    score += bestProvince;
  }
  return score - fuzzyCost * FUZZY_COST_PER_EDIT;
}

/**
 * Exact trước; với query ngắn (gõ tên xã) chèn thêm tên dài hơn chứa query.
 * Query dài kiểu đủ huyện/tỉnh: chỉ exact để tránh nhiễu khi auto-điền.
 */
function pickScoredPool(
  scored: { entry: Entry; score: number }[],
  tokenCount: number,
): { entry: Entry; score: number }[] {
  const sorted = [...scored].sort(
    (a, b) =>
      b.score - a.score ||
      a.entry.oldText.localeCompare(b.entry.oldText, 'vi') ||
      a.entry.newText.localeCompare(b.entry.newText, 'vi'),
  );
  const exact = sorted.filter((item) => item.score >= 1000);
  const wantExpansions = tokenCount > 0 && tokenCount <= 3;
  // Cùng mã xã mới chỉ giữ 1 dòng (ưu tiên bản có oldText / điểm cao hơn đã sort).
  const destKey = (item: { entry: Entry }) => `${item.entry.provinceCode}:${item.entry.wardCode}`;

  if (!wantExpansions) {
    const pool = exact.length > 0 ? exact : sorted;
    const out: { entry: Entry; score: number }[] = [];
    const seen = new Set<string>();
    for (const item of pool) {
      const key = destKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
      if (out.length >= LIMIT) break;
    }
    return out;
  }

  const expansions = sorted.filter((item) => item.score >= 700 && item.score < 1000);
  const out: { entry: Entry; score: number }[] = [];
  const seen = new Set<string>();
  const push = (item: { entry: Entry; score: number }) => {
    const key = destKey(item);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  };

  const reserve = Math.min(EXPANSION_RESERVE, expansions.length);
  for (const item of exact) {
    if (out.length >= LIMIT - reserve) break;
    push(item);
  }
  for (const item of expansions) {
    if (out.length >= LIMIT) break;
    push(item);
  }
  for (const item of sorted) {
    if (out.length >= LIMIT) break;
    push(item);
  }
  return out;
}

export type LegacySelectTree = {
  provinces: string[];
  /** Tỉnh → danh sách huyện/quận cũ */
  districts: Record<string, string[]>;
  /** `${tỉnh}\t${huyện}` → danh sách xã/phường cũ */
  wards: Record<string, string[]>;
};

function wardBucketKey(province: string, district: string): string {
  return `${province}\t${district}`;
}

/** Cây chọn tay 3 cấp từ file ánh xạ (một lần khi load). */
export function buildLegacySelectTree(mapping: Readonly<Record<string, string>>): LegacySelectTree {
  const provinceNames = new Map<string, string>();
  const districtNames = new Map<string, Map<string, string>>();
  const wardNames = new Map<string, Map<string, string>>();

  for (const key of Object.keys(mapping)) {
    const parts = splitOldKey(key);
    if (!parts) continue;
    const pLoose = loose(parts.province);
    const dLoose = loose(parts.district);
    const wLoose = loose(parts.ward);
    if (!provinceNames.has(pLoose)) provinceNames.set(pLoose, displayName(parts.province));
    let districts = districtNames.get(pLoose);
    if (!districts) {
      districts = new Map();
      districtNames.set(pLoose, districts);
    }
    if (!districts.has(dLoose)) districts.set(dLoose, displayName(parts.district));
    const bucket = wardBucketKey(pLoose, dLoose);
    let wards = wardNames.get(bucket);
    if (!wards) {
      wards = new Map();
      wardNames.set(bucket, wards);
    }
    if (!wards.has(wLoose)) wards.set(wLoose, displayName(parts.ward));
  }

  const provinces = [...provinceNames.values()].sort((a, b) => a.localeCompare(b, 'vi'));
  const districts: Record<string, string[]> = {};
  const wards: Record<string, string[]> = {};
  for (const [pLoose, pName] of provinceNames) {
    const distMap = districtNames.get(pLoose);
    districts[pName] = distMap
      ? [...distMap.values()].sort((a, b) => a.localeCompare(b, 'vi'))
      : [];
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

/** Chọn tay tỉnh/huyện/xã cũ → địa chỉ 2 cấp. */
export function resolveLegacyManual(
  rows: readonly AddressSelectRow[],
  mapping: Readonly<Record<string, string>>,
  selection: { province: string; district: string; ward: string },
): LegacySuggestion | null {
  const p = loose(selection.province);
  const d = loose(selection.district);
  const w = loose(selection.ward);
  if (!p || !d || !w) return null;

  let matched: { oldParts: { ward: string; district: string; province: string }; value: string } | null = null;
  for (const [key, value] of Object.entries(mapping)) {
    const oldParts = splitOldKey(key);
    if (!oldParts) continue;
    if (loose(oldParts.province) !== p || loose(oldParts.district) !== d || loose(oldParts.ward) !== w) continue;
    matched = { oldParts, value };
    break;
  }
  if (!matched) return null;

  const next = splitNewValue(matched.value);
  if (!next) return null;
  const lookup = buildWardLookup(rows);
  const resolved = lookup.get(`${stripWard(loose(next.ward))}|${stripProvince(loose(next.province))}`);
  if (!resolved || resolved === 'ambiguous') return null;
  return {
    oldText: `${displayName(matched.oldParts.ward)} · ${displayName(matched.oldParts.district)} · ${displayName(matched.oldParts.province)}`,
    newText: `${next.ward} · ${next.province}`,
    provinceCode: resolved.provinceCode,
    wardCode: resolved.wardCode,
    line: '',
  };
}

export function searchLegacyAddress(
  rows: readonly AddressSelectRow[],
  mapping: Readonly<Record<string, string>>,
  raw: string,
): LegacySearchResult {
  const entries = indexEntries(rows, mapping);
  const provinceBares = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === 'current') provinceBares.add(entry.provinceTokens.join(' '));
  }
  const prepared = prepareQuery(raw, provinceBares, cachedPlaceSplits ?? undefined);
  const compact = prepared.tokens.join('');
  const baseDebug = {
    raw,
    tokens: [...prepared.tokens],
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

  const scored: { entry: Entry; score: number }[] = [];
  for (const entry of entries) {
    const score = scoreEntry(entry, prepared.tokens);
    if (score <= 0) continue;
    if (compact.length < 4 && score < 1000) continue;
    scored.push({ entry, score });
  }
  const pool = pickScoredPool(scored, prepared.tokens.length);
  const top = [...scored]
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
}
