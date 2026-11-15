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

export type LegacySearchResult = {
  items: LegacySuggestion[];
  more: boolean;
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

const LIMIT = 8;

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
  text = text
    .replace(/^(?:đc|dc|địa\s*chỉ|dia\s*chi)\s*[:：-]?\s*/i, '')
    .replace(/[|]+/g, ' ')
    .replace(/\s+/g, ' ')
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

  for (const piece of pieces) {
    const folded = loose(piece);
    if (!folded) continue;
    if (
      /^(?:xom|thon|ap|to|khu|so|duong|pho|ngo|hem|ke|gan|nha|dc|dia chi)\b/.test(folded) ||
      /\b(?:thon|xom|ap)\b/.test(folded) ||
      /^\d/.test(folded)
    ) {
      street.push(piece.replace(/^(?:đc|dc|địa\s*chỉ|dia\s*chi)\s*[:：-]?\s*/i, '').trim() || piece);
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
    const tokens = wordTokens(bare).flatMap(expandAlias);
    if (provinceBares.has(bare)) provinceTokens.push(...tokens);
    else looseTokens.push(...tokens);
  }

  return {
    tokens: [...wardTokens, ...looseTokens, ...districtTokens, ...provinceTokens],
    line: street.join(', '),
    provinceBares,
  };
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
  return /^(?:dc|dia|chi|nha|van|hoa|thon|xom|ap|to|khu|so|duong|pho|ngo|hem|ke|gan|con|pheo)$/.test(token);
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
    // Không lấy «An Phú» giữa «Long Bình - An Phú - An Giang» làm xã — phần trước phải là số nhà/đường.
    const before = tokens.slice(0, at);
    if (before.some((token) => !isStreetToken(token))) return 0;
    score = 1000 + entry.wardTokens.length * 10 + (entry.kind === 'old' ? 5 : 0);
    rest = [...before, ...tokens.slice(at + entry.wardTokens.length)];
  } else if (
    entry.wardTokens.length > tokens.length &&
    tokens.length > 0 &&
    entry.wardTokens.slice(0, tokens.length).every((token, index) => token === tokens[index])
  ) {
    score = 700;
    rest = [];
  } else {
    return 0;
  }
  if (!restCovered(rest, entry.districtTokens, entry.provinceTokens)) return 0;
  if (rest.length > 0 && entry.districtTokens.length > 0 && entry.districtTokens.every((token) => rest.includes(token))) score += 200;
  if (rest.length > 0 && entry.provinceTokens.length > 0 && entry.provinceTokens.every((token) => rest.includes(token))) score += 200;
  return score;
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
  if (compact.length < 3) return { items: [], more: false };

  const scored: { entry: Entry; score: number }[] = [];
  for (const entry of entries) {
    const score = scoreEntry(entry, prepared.tokens);
    if (score <= 0) continue;
    if (compact.length < 4 && score < 1000) continue;
    scored.push({ entry, score });
  }
  scored.sort((a, b) => b.score - a.score || a.entry.oldText.localeCompare(b.entry.oldText, 'vi') || a.entry.newText.localeCompare(b.entry.newText, 'vi'));
  const exact = scored.filter((item) => item.score >= 1000);
  const pool = exact.length > 0 ? exact : scored;
  const deduped: typeof pool = [];
  const seen = new Set<string>();
  for (const item of pool) {
    const key = `${item.entry.provinceCode}:${item.entry.wardCode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return {
    items: deduped.slice(0, LIMIT).map((item) => ({
      oldText: item.entry.oldText,
      newText: item.entry.newText,
      provinceCode: item.entry.provinceCode,
      wardCode: item.entry.wardCode,
      line: prepared.line,
    })),
    more: deduped.length > LIMIT,
  };
}
