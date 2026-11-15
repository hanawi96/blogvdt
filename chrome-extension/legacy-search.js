/**
 * Tìm địa chỉ cũ → mới. Cùng quy tắc chặt với src/features/address/legacy.ts
 * (ưu tiên cụm phường/xã liền mạch, không chấm điểm mờ từng token).
 */

const SEARCH_LIMIT = 12;
const CENTRAL_PROVINCES = [
  'thành phố hồ chí minh',
  'thành phố hà nội',
  'thành phố hải phòng',
  'thành phố đà nẵng',
  'thành phố cần thơ',
  'thành phố huế',
];

const ALIAS_TOKENS = {
  hcm: ['ho', 'chi', 'minh'],
  tphcm: ['ho', 'chi', 'minh'],
  sg: ['ho', 'chi', 'minh'],
  hn: ['ha', 'noi'],
  dn: ['da', 'nang'],
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

function expandAlias(token) {
  return ALIAS_TOKENS[token] || [token];
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

/** Chuẩn hóa tin chat: bỏ SĐT/tên đầu, đổi «A - B - C» thành dấu phẩy, tách ghi chú (...). */
function normalizeChatAddressQuery(raw) {
  const source = String(raw || '').replace(/\u00a0/g, ' ');
  const chatMeta = /(?:\+?84|0)\d{8,10}/.test(source) || source.includes('|');
  let text = source;
  const notes = [];
  text = text.replace(/\(([^)]{2,120})\)/g, (_, note) => {
    notes.push(String(note).trim());
    return ', ';
  });
  if (text.includes('|')) text = text.slice(text.lastIndexOf('|') + 1);
  text = text.replace(/(?:^|[\s,;:])(?:\+?84|0)\d{8,10}(?=[\s,;:|]|$)/g, ' ');
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

function prepareQuery(raw, provinceBares) {
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
  };
}

function indexOfSlice(hay, needle) {
  if (!needle.length || needle.length > hay.length) return -1;
  for (let index = 0; index <= hay.length - needle.length; index += 1) {
    if (needle.every((token, offset) => hay[index + offset] === token)) return index;
  }
  return -1;
}

function isStreetToken(token) {
  if (!token || token.length <= 1 || /^\d/.test(token)) return true;
  return /^(?:dc|dia|chi|nha|van|hoa|thon|xom|ap|to|khu|so|duong|pho|ngo|hem|ke|gan|con|pheo)$/.test(token);
}

function restCovered(rest, district, province) {
  if (!rest.length) return true;
  const cover = [...district, ...province];
  if (province.length > 0) {
    const provinceHit = province.some((token) => rest.includes(token));
    if (provinceHit && !province.every((token) => rest.includes(token))) return false;
  }
  if (district.length > 0) {
    const districtHit = district.some((token) => rest.includes(token));
    if (districtHit && !district.every((token) => rest.includes(token))) return false;
  }
  if (!cover.length) return true;
  const sameSet = cover.every((token) => rest.includes(token)) && rest.every((token) => cover.includes(token));
  return indexOfSlice(cover, rest) >= 0 || sameSet || cover.every((token) => rest.includes(token));
}

function scoreEntry(entry, tokens) {
  if (!entry.wardTokens.length || !tokens.length) return 0;
  const at = indexOfSlice(tokens, entry.wardTokens);
  let score = 0;
  let rest = [];
  if (at >= 0) {
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
  if (rest.length > 0 && entry.districtTokens.length > 0 && entry.districtTokens.every((token) => rest.includes(token))) {
    score += 200;
  }
  if (rest.length > 0 && entry.provinceTokens.length > 0 && entry.provinceTokens.every((token) => rest.includes(token))) {
    score += 200;
  }
  return score;
}

function createLegacySearcher(mapping, rows) {
  const records = [];
  const provinceBares = new Set();

  for (const [provinceCode, provinceName, wards] of rows) {
    provinceBares.add(stripProvince(loose(provinceName)));
    for (const [wardCode, wardName] of wards) {
      records.push({
        kind: 'current',
        wardTokens: wordTokens(stripWard(loose(wardName))),
        districtTokens: [],
        provinceTokens: wordTokens(stripProvince(loose(provinceName))),
        oldText: '',
        newText: `${abbreviateAdminLabel(wardName)} · ${abbreviateAdminLabel(provinceName)}`,
        provinceCode,
        wardCode,
        provinceName,
        wardName,
      });
    }
  }

  for (const [key, value] of Object.entries(mapping)) {
    const parsed = parseOldAddressKey(key);
    const next = splitNewAddress(value);
    if (!parsed || !next) continue;
    const province = findProvince(rows, next.province);
    const ward = province ? findWard(province.wards, next.ward) : null;
    if (!province || !ward) continue;
    records.push({
      kind: 'old',
      wardTokens: wordTokens(stripWard(loose(parsed.ward))),
      districtTokens: wordTokens(stripDistrict(loose(parsed.district))),
      provinceTokens: wordTokens(stripProvince(loose(parsed.province))),
      oldText: `${abbreviateAdminLabel(parsed.ward)} · ${abbreviateAdminLabel(parsed.district)} · ${abbreviateAdminLabel(parsed.province)}`,
      newText: `${abbreviateAdminLabel(next.ward)} · ${abbreviateAdminLabel(next.province)}`,
      provinceCode: province.code,
      wardCode: ward.code,
      provinceName: province.name,
      wardName: ward.name,
    });
  }

  return {
    size: records.length,
    search(query) {
      const prepared = prepareQuery(query, provinceBares);
      const compact = prepared.tokens.join('');
      if (compact.length < 3) return { items: [], more: false };

      const scored = [];
      for (const entry of records) {
        const score = scoreEntry(entry, prepared.tokens);
        if (score <= 0) continue;
        if (compact.length < 4 && score < 1000) continue;
        scored.push({ entry, score });
      }
      scored.sort(
        (a, b) =>
          b.score - a.score ||
          a.entry.oldText.localeCompare(b.entry.oldText, 'vi') ||
          a.entry.newText.localeCompare(b.entry.newText, 'vi'),
      );
      const exact = scored.filter((item) => item.score >= 1000);
      const pool = exact.length > 0 ? exact : scored;
      const deduped = [];
      const seen = new Set();
      for (const item of pool) {
        const key = `${item.entry.provinceCode}:${item.entry.wardCode}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(item);
      }
      return {
        items: deduped.slice(0, SEARCH_LIMIT).map((item) => ({
          oldText: item.entry.oldText,
          newText: item.entry.newText,
          provinceCode: item.entry.provinceCode,
          wardCode: item.entry.wardCode,
          provinceName: item.entry.provinceName,
          wardName: item.entry.wardName,
          line: prepared.line,
        })),
        more: deduped.length > SEARCH_LIMIT,
      };
    },
  };
}

globalThis.createLegacySearcher = createLegacySearcher;
