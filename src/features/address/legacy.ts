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
  provinceTokens: readonly string[];
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

/** Số gợi ý tối đa; ưu tiên đủ (exact + tên dài hơn chứa query). */
const LIMIT = 20;
/** Giữ chỗ cho xã/phường dài hơn khi query là tiền tố (vd «long thành» → «long thành bắc»). */
const EXPANSION_RESERVE = 8;

let cachedRows: readonly AddressSelectRow[] | null = null;
let cachedMapping: Readonly<Record<string, string>> | null = null;
let cachedEntries: Entry[] | null = null;

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
    entries.push({
      kind: 'old',
      wardTokens: wordTokens(stripWard(loose(oldParts.ward))),
      districtTokens: wordTokens(stripDistrict(loose(oldParts.district))),
      provinceTokens: wordTokens(stripProvince(loose(oldParts.province))),
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

function expandAlias(token: string): readonly string[] {
  return ALIAS_TOKENS[token] ?? [token];
}

/**
 * p5 / P.5 / ph 14 → Phường N; Q8 / q.8 → Quận N.
 * Quận 1–12 mà chưa có tỉnh → thêm TP.HCM (quận số hầu hết thuộc HCM).
 */
function expandWardDistrictShortcuts(text: string): string {
  let out = String(text || '');
  // Không mở khi dính chữ liền trước (tránh «ấp» + «p5» kiểu biên ASCII \b).
  out = out.replace(/(^|[^0-9\p{L}])(?:q|quận)\.?\s*(\d{1,2})(?=$|[^0-9])/giu, '$1Quận $2');
  out = out.replace(/(^|[^0-9\p{L}])(?:p|ph|phường)\.?\s*(\d{1,2})(?=$|[^0-9])/giu, '$1Phường $2');
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

/** Chuẩn hóa tin chat: bỏ SĐT/tên đầu, đổi «A - B - C» thành dấu phẩy, tách ghi chú (...). */
function normalizeChatAddressQuery(raw: string): { text: string; notes: string[] } {
  const source = String(raw || '').replace(/\u00a0/g, ' ');
  const chatMeta = /(?:\+?84|0)\d{8,10}/.test(source) || source.includes('|');
  let text = source;
  const notes: string[] = [];
  text = text.replace(/\(([^)]{2,120})\)/g, (_, note: string) => {
    notes.push(note.trim());
    return ', ';
  });
  if (text.includes('|')) text = text.slice(text.lastIndexOf('|') + 1);
  text = text.replace(/(?:^|[\s,;:])(?:\+?84|0)\d{8,10}(?=[\s,;:|]|$)/g, ' ');
  // Chỉ bỏ họ tên đầu khi tin có SĐT hoặc dấu | — tránh nuốt «xã Tân…,».
  if (chatMeta) {
    text = text.replace(
      /^(?!.*(?:phuong|xa|huyen|quan|tinh|thanh pho|tp|thi tran|thi xa)\b)\p{L}+(?:\s+\p{L}+){0,3}\s*,\s*/iu,
      '',
    );
  }
  text = text.replace(/\s*[-–—]\s*/g, ', ');
  // «Sơn.Ngũ Lão» / «Lão . Thuỷ» → phẩy; không đụng số nhà (12.5) hay P.5.
  text = text.replace(/(?<=\p{L})\s*\.\s*(?=\p{L})/gu, ', ');
  text = expandWardDistrictShortcuts(text);
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

function prepareQuery(raw: string, provinceBares: ReadonlySet<string>): PreparedQuery {
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

  for (const piece of pieces) {
    const folded = loose(piece);
    if (!folded) continue;
    const pieceTokens = wordTokens(folded);
    const hasAdminLabel = /\b(?:phuong|xa|thi tran|huyen|quan|thi xa|tinh|thanh pho|tp)\b/.test(folded);
    const hasHamlet = /\b(?:thon|xom|ap)\b/.test(folded);
    const startsStreet = /^(?:xom|thon|ap|to|khu|so|duong|pho|ngo|hem|ke|gan|nha|dc|dia chi)\b/.test(folded);

    // «38/27a bình trị đông bình tân tphcm» — không nuốt cả câu vì bắt đầu bằng số.
    if (/^\d/.test(folded)) {
      if (pieceTokens.length <= 4) {
        street.push(cleanStreetPiece(piece));
        continue;
      }
      const peeled = peelLeadingStreetTokens(pieceTokens.flatMap(expandAlias));
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
    if ((startsStreet || hasHamlet) && !hasAdminLabel) {
      if (pieceTokens.length <= 4) {
        street.push(cleanStreetPiece(piece));
        continue;
      }
      const peeled = peelLeadingStreetTokens(pieceTokens.flatMap(expandAlias));
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
      wardTokens.push(...wordTokens(stripWard(folded)).flatMap(expandAlias));
      continue;
    }
    if (/^(?:huyen|quan|thi xa)\b/.test(folded)) {
      districtTokens.push(...wordTokens(stripDistrict(folded)).flatMap(expandAlias));
      continue;
    }
    if (/^tinh\b/.test(folded)) {
      provinceTokens.push(...wordTokens(stripProvince(folded)).flatMap(expandAlias));
      continue;
    }
    if (/^(?:thanh pho|tp)\b/.test(folded)) {
      const bare = stripProvince(folded);
      const tokens = wordTokens(bare).flatMap(expandAlias);
      if (provinceBares.has(bare)) provinceTokens.push(...tokens);
      else districtTokens.push(...tokens);
      continue;
    }
    const bare = stripProvince(stripDistrict(stripWard(folded)));
    let tokens = wordTokens(bare).flatMap(expandAlias);
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
    tokens: [...wardTokens, ...looseTokens, ...districtTokens, ...provinceTokens],
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

function indexOfSlice(hay: readonly string[], needle: readonly string[]): number {
  if (needle.length === 0 || needle.length > hay.length) return -1;
  for (let index = 0; index <= hay.length - needle.length; index += 1) {
    if (needle.every((token, offset) => hay[index + offset] === token)) return index;
  }
  return -1;
}

function isStreetToken(token: string): boolean {
  if (!token || token.length <= 1 || /^\d/.test(token)) return true;
  return /^(?:dc|dia|chi|nha|van|hoa|thon|xom|ap|to|khu|so|duong|pho|ngo|hem|ke|gan|con|pheo|lo)$/.test(token);
}

function restCovered(rest: readonly string[], district: readonly string[], province: readonly string[]): boolean {
  if (rest.length === 0) return true;
  const cover = [...district, ...province];
  // Cho phép số nhà/đường còn lại; chỉ bắt buộc đúng huyện/tỉnh nếu chúng xuất hiện trong câu.
  if (province.length > 0) {
    const provinceHit = province.some((token) => rest.includes(token));
    if (provinceHit && !province.every((token) => rest.includes(token))) return false;
  }
  if (district.length > 0) {
    const districtHit = district.some((token) => rest.includes(token));
    if (districtHit && !district.every((token) => rest.includes(token))) return false;
  }
  if (cover.length === 0) return true;
  const sameSet = cover.every((token) => rest.includes(token)) && rest.every((token) => cover.includes(token));
  return indexOfSlice(cover, rest) >= 0 || sameSet || cover.every((token) => rest.includes(token));
}

function scoreEntry(entry: Entry, tokens: readonly string[]): number {
  if (entry.wardTokens.length === 0 || tokens.length === 0) return 0;
  const at = indexOfSlice(tokens, entry.wardTokens);
  let score = 0;
  let rest: string[] = [];
  if (at >= 0) {
    const before = tokens.slice(0, at);
    const after = tokens.slice(at + entry.wardTokens.length);
    rest = [...before, ...after];
    const beforeHasPlace = before.some((token) => !isStreetToken(token));
    if (beforeHasPlace) {
      // «Ngũ Lão, Thuỷ Nguyên, Hải Phòng»: tên cũ/xóm trước phường mới — chỉ nhận khi phần SAU đã đủ tỉnh.
      // Không cộng thưởng huyện/tỉnh (giữ < 1000) để không át khớp xã cũ exact.
      const provinceAfter =
        entry.provinceTokens.length > 0 && entry.provinceTokens.every((token) => after.includes(token));
      if (!provinceAfter) return 0;
      if (!restCovered(rest, entry.districtTokens, entry.provinceTokens)) return 0;
      return 850 + entry.wardTokens.length * 10 + (entry.kind === 'old' ? 5 : 0);
    }
    // Khớp đủ tên xã trong query.
    score = 1000 + entry.wardTokens.length * 10 + (entry.kind === 'old' ? 5 : 0);
  } else {
    // Query là đoạn liên tiếp trong tên xã dài hơn: «long thành» ⊂ «long thành bắc».
    const wardAt = indexOfSlice(entry.wardTokens, tokens);
    if (wardAt < 0 || entry.wardTokens.length <= tokens.length) return 0;
    const prefix = wardAt === 0;
    score = (prefix ? 920 : 860) + tokens.length * 15 + (entry.kind === 'old' ? 5 : 0);
    rest = [];
  }
  if (!restCovered(rest, entry.districtTokens, entry.provinceTokens)) return 0;
  if (rest.length > 0 && entry.districtTokens.length > 0 && entry.districtTokens.every((token) => rest.includes(token))) score += 200;
  if (rest.length > 0 && entry.provinceTokens.length > 0 && entry.provinceTokens.every((token) => rest.includes(token))) score += 200;
  return score;
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
  const prepared = prepareQuery(raw, provinceBares);
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
