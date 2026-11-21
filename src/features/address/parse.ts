/** Dòng trong address-select.json: [mã tỉnh, tên tỉnh, [[mã xã, tên xã], ...]]. */
export type AddressSelectRow = readonly [string, string, readonly (readonly [string, string])[]];

export type ChatAddressMatch = {
  provinceCode: string;
  wardCode: string | null;
  line: string;
  /** high = đủ tỉnh+xã; medium = chỉ tỉnh; low = không khớp danh mục. */
  confidence: 'high' | 'medium' | 'low';
  /** SĐT tách được từ text (nếu có). */
  phones?: string[];
};

const PHONE_RE = /(?:\+?84|0)\d{8,10}/g;

/** Bỏ dấu + gộp khoảng trắng để so khớp tên hành chính. */
export function foldAddressText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/[.,;:!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const PROVINCE_PREFIX = /^(tinh|thanh pho|tp)\s+/;
/** Đủ từ; viết tắt P./Ph./X./TT./Q. chỉ khi có dấu cách sau (tránh nuốt "phu" của Phú). */
const WARD_FULL_PREFIX = /^(phuong|xa|thi tran|thi xa)\s+/;
const WARD_SHORT_PREFIX = /^(p|ph|x|tt|q)\.?\s+/;

function stripAdminPrefix(folded: string, kind: 'province' | 'ward'): string {
  let current = folded.trim();
  if (kind === 'province') return current.replace(PROVINCE_PREFIX, '').trim();
  for (let i = 0; i < 2; i += 1) {
    const next = current.replace(WARD_FULL_PREFIX, '').replace(WARD_SHORT_PREFIX, '').trim();
    if (next === current) break;
    current = next;
  }
  return current;
}

/**
 * Mã 2–4 ký tự chỉ khi đứng cuối địa chỉ. Chỉ map tỉnh còn trong danh sách 2 cấp.
 * `dn` giữ nghĩa Đà Nẵng qua alias phía dưới, không đổi thành Đồng Nai.
 */
/**
 * Mã cuối câu → tỉnh/TP còn trong danh mục 2 cấp (sau sáp nhập 2025).
 * Tránh mã trùng: dn=Đà Nẵng (không Đồng Nai), tn=Thái Nguyên (Tây Ninh=tnh).
 */
const END_PROVINCE_CODES: Readonly<Record<string, string>> = {
  ag: 'An Giang',
  kg: 'An Giang',
  bn: 'Bắc Ninh',
  bg: 'Bắc Ninh',
  cb: 'Cao Bằng',
  cm: 'Cà Mau',
  bl: 'Cà Mau',
  db: 'Điện Biên',
  dl: 'Đắk Lắk',
  py: 'Đắk Lắk',
  dnai: 'Đồng Nai',
  bp: 'Đồng Nai',
  dt: 'Đồng Tháp',
  tg: 'Đồng Tháp',
  gl: 'Gia Lai',
  bdinh: 'Gia Lai',
  ht: 'Hà Tĩnh',
  hue: 'Huế',
  tth: 'Huế',
  hy: 'Hưng Yên',
  tb: 'Hưng Yên',
  kh: 'Khánh Hòa',
  nt: 'Khánh Hòa',
  lb: 'Lai Châu',
  lc: 'Lào Cai',
  yb: 'Lào Cai',
  ld: 'Lâm Đồng',
  dno: 'Lâm Đồng',
  bth: 'Lâm Đồng',
  ls: 'Lạng Sơn',
  na: 'Nghệ An',
  nb: 'Ninh Bình',
  hnam: 'Ninh Bình',
  nd: 'Ninh Bình',
  pt: 'Phú Thọ',
  vp: 'Phú Thọ',
  hb: 'Phú Thọ',
  qn: 'Quảng Ninh',
  qng: 'Quảng Ngãi',
  kt: 'Quảng Ngãi',
  qt: 'Quảng Trị',
  qb: 'Quảng Trị',
  sl: 'Sơn La',
  th: 'Thanh Hóa',
  tn: 'Thái Nguyên',
  bk: 'Thái Nguyên',
  tnh: 'Tây Ninh',
  la: 'Tây Ninh',
  tq: 'Tuyên Quang',
  hag: 'Tuyên Quang',
  vl: 'Vĩnh Long',
  bt: 'Vĩnh Long',
  tv: 'Vĩnh Long',
  hn: 'Hà Nội',
  hp: 'Hải Phòng',
  hd: 'Hải Phòng',
  ct: 'Cần Thơ',
  st: 'Cần Thơ',
  haug: 'Cần Thơ',
  hcm: 'Hồ Chí Minh',
  sg: 'Hồ Chí Minh',
  brvt: 'Hồ Chí Minh',
  qnam: 'Đà Nẵng',
};

/** Viết tắt quận cũ còn trùng tên phường hiện tại. */
const LEGACY_AREA_HINTS: Readonly<Record<string, string>> = {
  'g/vap': 'Gò Vấp',
  'b/thanh': 'Bình Thạnh',
  'b/th': 'Bình Thạnh',
  't/duc': 'Thủ Đức',
  'p/nhuan': 'Phú Nhuận',
  'b/tan': 'Bình Tân',
  'b/t': 'Bình Tân',
  'b/chanh': 'Bình Chánh',
  'h/mon': 'Hóc Môn',
  'c/gio': 'Cần Giờ',
  'n/be': 'Nhà Bè',
  't/binh': 'Tân Bình',
  't/phu': 'Tân Phú',
};

/** Alias hay gặp trong chat → tên rút gọn tỉnh mới (đã fold). */
const PROVINCE_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ['hcm', 'ho chi minh'],
  ['tp hcm', 'ho chi minh'],
  ['tphcm', 'ho chi minh'],
  ['tp. hcm', 'ho chi minh'],
  ['sai gon', 'ho chi minh'],
  ['saigon', 'ho chi minh'],
  ['sg', 'ho chi minh'],
  ['binh duong', 'ho chi minh'],
  ['binhduong', 'ho chi minh'],
  ['ba ria vung tau', 'ho chi minh'],
  ['brvt', 'ho chi minh'],
  ['hn', 'ha noi'],
  ['ha noi', 'ha noi'],
  ['hanoi', 'ha noi'],
  ['dn', 'da nang'],
  ['da nang', 'da nang'],
  ['danang', 'da nang'],
  ['quang nam', 'da nang'],
  ['quangnam', 'da nang'],
  ['hp', 'hai phong'],
  ['hai phong', 'hai phong'],
  ['haiphong', 'hai phong'],
  ['hai duong', 'hai phong'],
  ['ct', 'can tho'],
  ['can tho', 'can tho'],
  ['cantho', 'can tho'],
  ['soc trang', 'can tho'],
  ['hau giang', 'can tho'],
  ['hue', 'hue'],
  ['tphue', 'hue'],
  ['thua thien hue', 'hue'],
  ['kien giang', 'an giang'],
  ['kiengiang', 'an giang'],
  ['bac giang', 'bac ninh'],
  ['bac lieu', 'ca mau'],
  ['phu yen', 'dak lak'],
  ['binh phuoc', 'dong nai'],
  ['tien giang', 'dong thap'],
  ['binh dinh', 'gia lai'],
  ['thai binh', 'hung yen'],
  ['ninh thuan', 'khanh hoa'],
  ['dak nong', 'lam dong'],
  ['binh thuan', 'lam dong'],
  ['yen bai', 'lao cai'],
  ['ha nam', 'ninh binh'],
  ['nam dinh', 'ninh binh'],
  ['vinh phuc', 'phu tho'],
  ['hoa binh', 'phu tho'],
  ['kon tum', 'quang ngai'],
  ['quang binh', 'quang tri'],
  ['long an', 'tay ninh'],
  ['bac kan', 'thai nguyen'],
  ['ha giang', 'tuyen quang'],
  ['ben tre', 'vinh long'],
  ['tra vinh', 'vinh long'],
];

const CHAT_NOISE =
  /^(?:\s*(?:ship|gửi|gui|giao hàng|giao|về|ve|đến|den|tới|toi|về địa chỉ|ve dia chi|địa chỉ là|dia chi la|địa chỉ|dia chi|address|là|la|:)+)+/i;

function stripChatNoise(text: string): string {
  let current = text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 4; i += 1) {
    const next = current.replace(CHAT_NOISE, '').trim();
    if (next === current) break;
    current = next;
  }
  return current;
}

/** Gộp 0902.939.419 / 0902-939-419 / +84 902 939 419 thành một dãy số trước khi tách. */
function collapsePhoneSeparators(raw: string): string {
  return raw.replace(/(?:\+?[ \t]*84|0)(?:[ \t.\-]*\d){8,10}(?!\d)/g, (match) => match.replace(/[^\d+]/g, ''));
}

/** Tách SĐT khỏi text địa chỉ; trả text sạch + danh sách số đã chuẩn hóa thô. */
export function extractPhonesFromText(raw: string): { text: string; phones: string[] } {
  const phones: string[] = [];
  const text = collapsePhoneSeparators(String(raw || '')).replace(PHONE_RE, (match) => {
    const compact = match.replace(/\D/g, '');
    const local =
      compact.startsWith('84') && compact.length >= 11 ? `0${compact.slice(2)}` : compact.startsWith('0') ? compact : match;
    if (/^0\d{9,10}$/.test(local)) {
      phones.push(local);
      return ' ';
    }
    return match;
  });
  // Thiếu số 0 đầu, đúng 9 số mạng di động, và chưa tách được số nào.
  const withFallback =
    phones.length > 0
      ? text
      : text.replace(/(^|[^\d])([35789]\d{8})(?!\d)/g, (_full, prefix: string, digits: string) => {
          phones.push(`0${digits}`);
          return `${prefix} `;
        });
  return {
    text: withFallback.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim(),
    phones: [...new Set(phones)],
  };
}

function provinceKeys(name: string): Set<string> {
  const folded = foldAddressText(name);
  const short = stripAdminPrefix(folded, 'province');
  const keys = new Set<string>([folded, short]);
  for (const [alias, target] of PROVINCE_ALIASES) {
    if (short === target || folded.includes(target)) keys.add(alias);
  }
  return keys;
}

function wardKeys(name: string): Set<string> {
  const folded = foldAddressText(name);
  const short = stripAdminPrefix(folded, 'ward');
  return new Set([folded, short].filter((item) => item.length >= 2));
}

function partKeys(part: string, kind: 'province' | 'ward'): Set<string> {
  const folded = foldAddressText(part);
  const short = stripAdminPrefix(folded, kind);
  const keys = new Set<string>([folded, short].filter(Boolean));
  if (kind === 'province') {
    for (const [alias, target] of PROVINCE_ALIASES) {
      if (folded === alias || short === alias || folded.replace(/\s+/g, '') === alias.replace(/\s+/g, '')) {
        keys.add(target);
        keys.add(alias);
      }
    }
    // TPHCM không dấu cách sau fold vẫn bắt.
    const compact = folded.replace(/\s+/g, '');
    for (const [alias, target] of PROVINCE_ALIASES) {
      if (compact === alias.replace(/\s+/g, '')) {
        keys.add(target);
        keys.add(alias);
      }
    }
  }
  return keys;
}

function setsOverlap(left: Set<string>, right: Set<string>): boolean {
  for (const key of left) {
    if (right.has(key)) return true;
  }
  return false;
}

function longestKeySize(keys: Set<string>): number {
  let max = 0;
  for (const key of keys) max = Math.max(max, key.length);
  return max;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));
  for (let i = 0; i < rows; i += 1) matrix[i]![0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0]![j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost,
      );
    }
  }
  return matrix[a.length]![b.length]!;
}

function matchProvince(
  rows: readonly AddressSelectRow[],
  part: string,
): { code: string; name: string; wards: AddressSelectRow[2] } | null {
  const keys = partKeys(part, 'province');
  let best: { code: string; name: string; wards: AddressSelectRow[2]; score: number } | null = null;
  for (const [code, name, wards] of rows) {
    const candidates = provinceKeys(name);
    if (!setsOverlap(keys, candidates)) continue;
    const score = longestKeySize(new Set([...keys].filter((key) => candidates.has(key))));
    if (!best || score > best.score) best = { code, name, wards, score };
  }
  return best ? { code: best.code, name: best.name, wards: best.wards } : null;
}

function matchWardExact(
  wards: AddressSelectRow[2],
  part: string,
): { code: string; name: string } | null {
  const keys = partKeys(part, 'ward');
  let best: { code: string; name: string; score: number } | null = null;
  for (const [code, name] of wards) {
    const candidates = wardKeys(name);
    if (!setsOverlap(keys, candidates)) continue;
    const score = longestKeySize(new Set([...keys].filter((key) => candidates.has(key))));
    if (!best || score > best.score) best = { code, name, score };
  }
  return best ? { code: best.code, name: best.name } : null;
}

/**
 * Fuzzy chỉ trong tỉnh đã chọn.
 * Ưu tiên: khoảng cách nhỏ trên tên rút; hoặc trùng token cuối + token đầu gần.
 */
function matchWardFuzzy(
  wards: AddressSelectRow[2],
  part: string,
): { code: string; name: string } | null {
  const query = stripAdminPrefix(foldAddressText(part), 'ward');
  if (query.length < 3) return null;
  const qTokens = query.split(' ').filter(Boolean);

  type Scored = { code: string; name: string; score: number };
  const scored: Scored[] = [];

  for (const [code, name] of wards) {
    const short = stripAdminPrefix(foldAddressText(name), 'ward');
    if (short.length < 2) continue;
    const dist = levenshtein(query, short);
    const maxLen = Math.max(query.length, short.length);
    let score = 0;
    if (dist === 0) score = 1000;
    else if (dist <= 2 && maxLen >= 5) score = 800 - dist * 40;
    else {
      const wTokens = short.split(' ').filter(Boolean);
      if (qTokens.length >= 2 && wTokens.length >= 2) {
        const lastQ = qTokens[qTokens.length - 1]!;
        const lastW = wTokens[wTokens.length - 1]!;
        const firstQ = qTokens[0]!;
        const firstW = wTokens[0]!;
        if (lastQ === lastW && lastQ.length >= 4) {
          const headDist = levenshtein(firstQ, firstW);
          if (headDist <= 2) score = 600 - headDist * 50;
        }
      }
    }
    if (score > 0) scored.push({ code, name, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  const second = scored[1];
  if (!top) return null;
  // Chỉ nhận khi rõ ràng hơn ứng viên thứ hai.
  if (second && top.score - second.score < 80 && top.score < 900) return null;
  if (top.score < 550) return null;
  return { code: top.code, name: top.name };
}

function matchWard(
  wards: AddressSelectRow[2],
  part: string,
): { code: string; name: string } | null {
  return matchWardExact(wards, part) ?? matchWardFuzzy(wards, part);
}

/**
 * Tách địa chỉ đã ghép `${số nhà}, ${xã}, ${tỉnh}` về mã + số nhà.
 * Khớp từ phải (tên tỉnh/xã) để số nhà vẫn được giữ nếu có dấu phẩy.
 */
export function matchComposedAddress(
  rows: readonly AddressSelectRow[],
  composed: string,
): { provinceCode: string; wardCode: string; line: string } | null {
  const text = composed.trim();
  if (!text) return null;
  for (const [provinceCode, provinceName, wards] of rows) {
    const provinceSuffix = `, ${provinceName}`;
    if (!text.endsWith(provinceSuffix)) continue;
    const withoutProvince = text.slice(0, -provinceSuffix.length);
    for (const [wardCode, wardName] of wards) {
      const wardSuffix = `, ${wardName}`;
      if (!withoutProvince.endsWith(wardSuffix)) continue;
      const line = withoutProvince.slice(0, -wardSuffix.length).trim();
      if (!line) continue;
      return { provinceCode, wardCode, line };
    }
  }
  return null;
}

function finishLine(value: string, fallback: string): string {
  return (
    stripChatNoise(value)
      .replace(/^[,.\s]+|[,.\s]+$/g, '')
      .trim()
      .slice(0, 240) || fallback.slice(0, 240)
  );
}

function expandLegacyHints(text: string): string {
  return text.replace(/\b[a-zA-Z]{1,3}\/[a-zA-Z]{2,}\b/g, (token) => LEGACY_AREA_HINTS[token.toLowerCase()] ?? token);
}

/** Mã tỉnh chỉ thay khi là từ cuối của đoạn cuối (sau dấu phẩy, hoặc từ cuối nếu không có phẩy). */
function expandEndProvinceCode(text: string): string {
  const parts = text.split(',');
  const lastIndex = parts.length - 1;
  const words = (parts[lastIndex] ?? '').trim().split(/\s+/).filter(Boolean);
  const hasComma = text.includes(',');
  if (words.length < 1 || (hasComma && words.length > 3) || (!hasComma && words.length < 2)) return text;
  const code = foldAddressText(words[words.length - 1] ?? '');
  const name = END_PROVINCE_CODES[code];
  if (!name) return text;
  words[words.length - 1] = name;
  parts[lastIndex] = ` ${words.join(' ')}`;
  return parts.join(',');
}

type SegmentKind = 'ward' | 'legacy' | 'plain';

function segmentKind(part: string): SegmentKind {
  const text = part.trim();
  if (/^(?:quận|quan|huyện|huyen|thị\s*xã|thi\s*xa|tx\.?|q\.)\s*\S/i.test(text) || /^q\s+\S/i.test(text)) return 'legacy';
  if (/^(?:phường|phuong|xã|xa|thị\s*trấn|thi\s*tran|p\.|ph\.|x\.|tt\.?)\s*\S/i.test(text) || /^(?:p|ph|x|tt)\s+\S/i.test(text)) {
    return 'ward';
  }
  return 'plain';
}

function stripSegmentPrefix(part: string): string {
  return part
    .trim()
    .replace(/^(?:quận|quan|huyện|huyen|thị\s*xã|thi\s*xa|tx\.?|phường|phuong|xã|xa|thị\s*trấn|thi\s*tran|q\.|p\.|ph\.|x\.|tt\.?|q|p|ph|x|tt)\s+/i, '');
}

/** Cụm tên phường/xã nguyên văn, không cần chữ «phường». Bỏ cụm trùng một mảnh tên tỉnh. */
function exactWardMention(
  wards: AddressSelectRow[2],
  text: string,
  provinceName: string,
): { code: string; name: string } | null {
  const folded = ` ${foldAddressText(text)} `;
  const provinceBare = stripAdminPrefix(foldAddressText(provinceName), 'province');
  const provinceParts = new Set(provinceBare.split(' ').filter((part) => part.length >= 2));
  let best: { code: string; name: string; score: number } | null = null;
  for (const [code, name] of wards) {
    const bare = stripAdminPrefix(foldAddressText(name), 'ward');
    if ((bare.length < 6 && bare.split(' ').length < 2) || bare === provinceBare || provinceParts.has(bare)) continue;
    const at = folded.indexOf(` ${bare} `);
    if (at < 0) continue;
    const score = bare.length * 1000 + at;
    if (!best || score > best.score) best = { code, name, score };
  }
  return best ? { code: best.code, name: best.name } : null;
}

function keywordWardMention(
  wards: AddressSelectRow[2],
  text: string,
): { code: string; name: string } | null {
  const folded = ` ${foldAddressText(text)} `;
  let best: { code: string; name: string; score: number } | null = null;
  for (const [code, name] of wards) {
    const bare = stripAdminPrefix(foldAddressText(name), 'ward');
    if (bare.length < 3) continue;
    const pattern = new RegExp(`(?:phuong|xa|thi tran|p|ph|x|tt)\\s+${bare.replace(/ /g, '\\s+')}(?:\\s|$)`);
    const at = folded.search(pattern);
    if (at < 0) continue;
    const score = bare.length * 1000 + at;
    if (!best || score > best.score) best = { code, name, score };
  }
  return best ? { code: best.code, name: best.name } : null;
}

function pickWardSegment(
  province: { wards: AddressSelectRow[2] },
  segments: readonly string[],
): { ward: { code: string; name: string }; index: number; kind: SegmentKind } | null {
  let legacy: { ward: { code: string; name: string }; index: number; kind: SegmentKind } | null = null;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const part = segments[index] ?? '';
    const kind = segmentKind(part);
    const ward = matchWard(province.wards, stripSegmentPrefix(part));
    if (!ward) continue;
    if (kind !== 'legacy') return { ward, index, kind };
    legacy ??= { ward, index, kind };
  }
  return legacy;
}

function stripWardWords(text: string, wardName: string): string {
  const bareWords = stripAdminPrefix(foldAddressText(wardName), 'ward').split(' ').filter(Boolean);
  if (bareWords.length === 0 || (bareWords.length === 1 && (bareWords[0]?.length ?? 0) < 6)) return text;
  const tokens = text.split(/\s+/).filter(Boolean);
  const folded = tokens.map((token) => foldAddressText(token));
  const drop = new Set<number>();
  for (let index = 0; index <= folded.length - bareWords.length; index += 1) {
    if (!bareWords.every((word, offset) => folded[index + offset] === word)) continue;
    for (let offset = 0; offset < bareWords.length; offset += 1) drop.add(index + offset);
    const previous = folded[index - 1] ?? '';
    if (previous === 'phuong' || previous === 'xa' || previous === 'p' || previous === 'ph' || previous === 'x' || previous === 'tt') {
      drop.add(index - 1);
    }
    if (previous === 'tran' && folded[index - 2] === 'thi') {
      drop.add(index - 1);
      drop.add(index - 2);
    }
  }
  return tokens.filter((_, index) => !drop.has(index)).join(' ');
}

function lineFromSegments(segments: readonly string[], wardIndex: number, wardName: string): string {
  const kept = segments.filter((part, index) => index !== wardIndex && segmentKind(part) !== 'legacy');
  const stripped = wardIndex < 0 ? stripWardWords(kept.join(', '), wardName) : kept.join(', ');
  return finishLine(stripped, kept.join(', ') || stripped);
}

/**
 * Nhận diện địa chỉ từ tin nhắn chat (viết tắt TPHCM, P./X., lỗi gõ nhẹ).
 * Thứ tự: tách SĐT → tỉnh → xã trong tỉnh → số nhà.
 */
export function parseChatAddress(rows: readonly AddressSelectRow[], raw: string): ChatAddressMatch | null {
  const extracted = extractPhonesFromText(String(raw || ''));
  const cleaned = expandEndProvinceCode(expandLegacyHints(stripChatNoise(extracted.text)));
  const phones = extracted.phones.length ? extracted.phones : undefined;
  if (cleaned.length < 4) return null;

  const withPhones = <T extends ChatAddressMatch>(match: T): T =>
    phones ? { ...match, phones } : match;

  const exact = matchComposedAddress(rows, cleaned);
  if (exact) return withPhones({ ...exact, confidence: 'high' });

  const parts = cleaned
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    const province = matchProvince(rows, parts[parts.length - 1]!);
    if (province) {
      const before = parts.slice(0, -1);
      const picked = pickWardSegment(province, before);
      const beforeText = before.join(', ');
      const mentioned =
        keywordWardMention(province.wards, beforeText) ?? exactWardMention(province.wards, beforeText, province.name);
      const chosen =
        picked && picked.kind === 'ward'
          ? picked
          : mentioned
            ? { ward: mentioned, index: -1, kind: 'ward' as const }
            : picked;
      if (chosen && (parts.length >= 3 || chosen.kind === 'ward')) {
        const line = lineFromSegments(before, chosen.index, chosen.ward.name);
        if (line) {
          return withPhones({
            provinceCode: province.code,
            wardCode: chosen.ward.code,
            line,
            confidence: 'high',
          });
        }
      }
      // 2 phần: có thể "số nhà + xã, tỉnh" không có phẩy giữa số nhà và xã
      if (parts.length === 2) {
        const head = parts[0]!;
        const headTokens = head.split(/\s+/).filter(Boolean);
        for (let take = Math.min(4, headTokens.length - 1); take >= 1; take -= 1) {
          const wardPart = headTokens.slice(-take).join(' ');
          const ward = matchWard(province.wards, wardPart);
          if (!ward) continue;
          const line = finishLine(headTokens.slice(0, -take).join(' '), head);
          if (!line) continue;
          return withPhones({
            provinceCode: province.code,
            wardCode: ward.code,
            line,
            confidence: 'high',
          });
        }
      }
      return withPhones({
        provinceCode: province.code,
        wardCode: null,
        line: finishLine(parts.slice(0, -1).join(', '), cleaned),
        confidence: 'medium',
      });
    }
  }

  // Không tách được bằng phẩy: tìm tỉnh ở cuối.
  let bestProvince: { code: string; name: string; wards: AddressSelectRow[2]; score: number } | null = null;
  const foldedAll = foldAddressText(cleaned);
  for (const [code, name, wards] of rows) {
    for (const key of provinceKeys(name)) {
      if (key.length < 3) continue;
      const at = foldedAll.lastIndexOf(key);
      if (at < 0) continue;
      const beforeOk = at === 0 || foldedAll[at - 1] === ' ';
      const afterOk = at + key.length === foldedAll.length || foldedAll[at + key.length] === ' ';
      if (!beforeOk || !afterOk) continue;
      const score = at * 1000 + key.length;
      if (!bestProvince || score > bestProvince.score) bestProvince = { code, name, wards, score };
    }
  }

  if (!bestProvince) {
    return withPhones({ provinceCode: '', wardCode: null, line: cleaned.slice(0, 240), confidence: 'low' });
  }

  const tokens = cleaned.split(/[,\s]+/).filter(Boolean);
  while (tokens.length > 0) {
    const tail = tokens[tokens.length - 1]!;
    if (setsOverlap(partKeys(tail, 'province'), provinceKeys(bestProvince.name))) {
      tokens.pop();
      continue;
    }
    if (tokens.length >= 2) {
      const two = `${tokens[tokens.length - 2]} ${tokens[tokens.length - 1]}`;
      if (setsOverlap(partKeys(two, 'province'), provinceKeys(bestProvince.name))) {
        tokens.pop();
        tokens.pop();
        continue;
      }
    }
    break;
  }
  let remainder = stripChatNoise(tokens.join(' ').trim());

  const wardParts = remainder.split(',').map((part) => part.trim()).filter(Boolean);
  if (wardParts.length >= 2) {
    const ward = matchWard(bestProvince.wards, wardParts[wardParts.length - 1]!);
    if (ward) {
      const line = finishLine(wardParts.slice(0, -1).join(', '), remainder);
      if (line) {
        return withPhones({
          provinceCode: bestProvince.code,
          wardCode: ward.code,
          line,
          confidence: 'high',
        });
      }
    }
  }

  const mentionedEarly =
    keywordWardMention(bestProvince.wards, remainder) ?? exactWardMention(bestProvince.wards, remainder, bestProvince.name);
  if (mentionedEarly) {
    const line = finishLine(stripWardWords(remainder, mentionedEarly.name), remainder);
    if (line) {
      return withPhones({
        provinceCode: bestProvince.code,
        wardCode: mentionedEarly.code,
        line,
        confidence: 'high',
      });
    }
  }

  const remTokens = remainder.split(/[,\s]+/).filter(Boolean);
  for (let take = Math.min(4, remTokens.length); take >= 1; take -= 1) {
    const tail = remTokens.slice(-take).join(' ');
    // Giữ tiền tố P/X nếu có ở token đầu của cụm.
    const ward = matchWard(bestProvince.wards, tail);
    if (!ward) continue;
    const line = finishLine(remTokens.slice(0, -take).join(' '), remainder);
    if (!line) continue;
    return withPhones({
      provinceCode: bestProvince.code,
      wardCode: ward.code,
      line,
      confidence: 'high',
    });
  }

  return withPhones({
    provinceCode: bestProvince.code,
    wardCode: null,
    line: finishLine(remainder, cleaned),
    confidence: 'medium',
  });
}

const PERSON_LINE_NOISE =
  /(phường|phuong|xã|quận|huyện|thành phố|thanh pho|tỉnh|tinh|đường|duong|phố|ngõ|hẻm|ấp|thôn|p\.|q\.)/i;

function looksLikePersonName(line: string, rows: readonly AddressSelectRow[]): boolean {
  const text = line.trim();
  if (text.length < 2 || text.length > 40) return false;
  if (/\d/.test(text) || PERSON_LINE_NOISE.test(text)) return false;
  if (matchProvince(rows, text)) return false;
  const letters = text.match(/\p{L}/gu);
  if (!letters || letters.length / text.length < 0.75) return false;
  const words = text.split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.length <= 4;
}

function lineLooksLikeAddress(line: string, rows: readonly AddressSelectRow[]): boolean {
  return /\d/.test(line) || PERSON_LINE_NOISE.test(line) || matchProvince(rows, line) !== null;
}

/** Bỏ emoticon/HTML Zalo và nhãn «SĐT:», «Địa chỉ:» nhưng giữ xuống dòng để tách tên. */
export function cleanChatPaste(raw: string): string {
  return String(raw || '')
    .replace(/\u00a0/g, ' ')
    .split(/\n+/)
    .map((line) => cleanChatLine(line))
    .filter((line) => line.length > 0 && !/^(?:sđt|sdt|đt|dt|địa chỉ|dia chi|dc)$/i.test(line))
    .join('\n');
}

function cleanChatLine(line: string): string {
  let text = line.replace(/<\/?[a-zA-Z][^>]*>/g, ' ');
  text = text.replace(/(^|[^\w])\/(?:heart|>:o:)(?!\w)/gi, '$1 ');
  text = text.replace(
    /(^|[\s,;]+)(?:strong\/?|heart(?::>?:?o:?)?|>:o:|\(\(:|:>|:o|:-h|:-\(\(|:-\)|:-\(|:\)|:\(|:D|:p|:-D)(?=[\s,;]+|$)/gi,
    '$1',
  );
  for (let i = 0; i < 3; i += 1) {
    const next = text
      .replace(/^(?:sđt|sdt|đt|dt|phone|tel|tên|ten|name|họ\s*tên|ho\s*ten)\s*[:：-]?\s*/i, '')
      .replace(/^(?:địa\s*chỉ|dia\s*chi|dc|addr|address)\s*[:：-]?\s*/i, '')
      .replace(/^[,:：\-–—.\s]+/, '')
      .trim();
    if (next === text) break;
    text = next;
  }
  text = text
    .replace(/(?:^|[,;]\s*)(?:sđt|sdt|đt|dt|phone|tel)\s*[:：-]?\s*/gi, ' ')
    .replace(/(?:^|[,;]\s*)(?:địa\s*chỉ|dia\s*chi|dc|addr|address)\s*[:：-]?\s*/gi, ' ');
  return text.replace(/[ \t]+/g, ' ').replace(/^[,:：\-–—.\s]+|[,:：\-–—.\s]+$/g, '').trim();
}

export type QuickRecipient = {
  phone: string | null;
  /** Dòng họ tên đứng riêng, đã tách khỏi địa chỉ. */
  name: string | null;
  match: ChatAddressMatch | null;
};

/**
 * Tách SĐT + địa chỉ từ đoạn dán nhanh (nhiều dòng, SĐT có dấu chấm).
 * Dòng đầu chỉ là họ tên thì bỏ khỏi địa chỉ, không điền vào ô tên.
 */
export function parseQuickRecipient(rows: readonly AddressSelectRow[], raw: string): QuickRecipient {
  const normalized = collapsePhoneSeparators(cleanChatPaste(raw));
  const phone = extractPhonesFromText(normalized).phones[0] ?? null;
  const lines = normalized
    .split(/\n+/)
    .map((line) =>
      extractPhonesFromText(line)
        .text.replace(/^[,.\-\s]+|[,.\-\s]+$/g, '')
        .trim(),
    )
    .filter(Boolean);
  let name: string | null = null;
  if (lines.length >= 2 && looksLikePersonName(lines[0] ?? '', rows) && lines.slice(1).some((line) => lineLooksLikeAddress(line, rows))) {
    name = lines[0] ?? null;
    lines.shift();
  }
  const addressText = lines.join(', ');
  const match = addressText.length >= 4 ? parseChatAddress(rows, addressText) : null;
  return { phone, name, match };
}

/** Ưu tiên khớp đủ xã+tỉnh; fallback chỉ đuôi tên tỉnh (địa chỉ cũ / lệch xã). */
export function provinceCodeFromAddress(rows: readonly AddressSelectRow[], composed: string): string | null {
  const full = matchComposedAddress(rows, composed);
  if (full) return full.provinceCode;
  const chat = parseChatAddress(rows, composed);
  if (chat?.provinceCode) return chat.provinceCode;
  const text = composed.trim();
  if (!text) return null;
  for (const [provinceCode, provinceName] of rows) {
    if (text === provinceName || text.endsWith(`, ${provinceName}`)) return provinceCode;
  }
  return null;
}

export function provinceNameMap(rows: readonly AddressSelectRow[]): Map<string, string> {
  return new Map(rows.map(([code, name]) => [code, name]));
}
