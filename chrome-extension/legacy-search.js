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

/**
 * p5 / P.5 / ph 14 → Phường N; Q8 / q.8 → Quận N.
 * Quận 1–12 mà chưa có tỉnh → thêm TP.HCM.
 */
function expandWardDistrictShortcuts(text) {
  let out = String(text || '');
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
  // «Sơn.Ngũ Lão» / «Lão . Thuỷ» → phẩy; không đụng số nhà (12.5) hay P.5.
  text = text.replace(/(?<=\p{L})\s*\.\s*(?=\p{L})/gu, ', ');
  text = expandWardDistrictShortcuts(text);
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
  if (!needle.length || needle.length > hay.length) return -1;
  for (let index = 0; index <= hay.length - needle.length; index += 1) {
    if (needle.every((token, offset) => hay[index + offset] === token)) return index;
  }
  return -1;
}

function isStreetToken(token) {
  if (!token || token.length <= 1 || /^\d/.test(token)) return true;
  return /^(?:dc|dia|chi|nha|van|hoa|thon|xom|ap|to|khu|so|duong|pho|ngo|hem|ke|gan|con|pheo|lo)$/.test(token);
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
    const after = tokens.slice(at + entry.wardTokens.length);
    rest = [...before, ...after];
    const beforeHasPlace = before.some((token) => !isStreetToken(token));
    if (beforeHasPlace) {
      const provinceAfter =
        entry.provinceTokens.length > 0 && entry.provinceTokens.every((token) => after.includes(token));
      if (!provinceAfter) return 0;
      if (!restCovered(rest, entry.districtTokens, entry.provinceTokens)) return 0;
      return 850 + entry.wardTokens.length * 10 + (entry.kind === 'old' ? 5 : 0);
    }
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
  if (rest.length > 0 && entry.districtTokens.length > 0 && entry.districtTokens.every((token) => rest.includes(token))) {
    score += 200;
  }
  if (rest.length > 0 && entry.provinceTokens.length > 0 && entry.provinceTokens.every((token) => rest.includes(token))) {
    score += 200;
  }
  return score;
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
  const tree = buildLegacySelectTree(mapping);

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
      const province = findProvince(rows, next.province);
      const ward = province ? findWard(province.wards, next.ward) : null;
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
    tree,
    resolveManual,
    search(query) {
      const prepared = prepareQuery(query, provinceBares);
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
