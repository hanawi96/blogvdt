
// ============================================
// PARSE ADDRESS v3 — 2-level (Tỉnh/TP → Phường/Xã)
// tree_2.json via addressSelector.data
// ============================================

let _provinceAliasMap = null;

function _resetParseAddrCache() {
    _provinceAliasMap = null;
}

function _nn(s) {
    return removeVietnameseTones(s || '').toLowerCase()
        .replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function _bare(name) {
    return _nn(name)
        .replace(/^(tinh|thanh pho|tp|quan|q|huyen|thi xa|tx|phuong|p|f|xa|thi tran|tt)\s+/, '')
        .trim();
}

function _bareNumericEqual(a, b) {
    if (!a || !b) return false;
    if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return false;
    return parseInt(a, 10) === parseInt(b, 10);
}

function _stripTrailingProvinceSuffix(seg, province) {
    if (!seg || !province) return seg;
    const sw = seg.trim().split(/\s+/).filter(Boolean);
    if (sw.length < 2) return seg;
    const pb = _bare(province.Name);
    if (!pb) return seg;
    for (let n = Math.min(3, sw.length - 1); n >= 1; n--) {
        const tail = sw.slice(-n).join(' ');
        if (_bare(tail) === pb) {
            const head = sw.slice(0, -n).join(' ').trim();
            return head || seg;
        }
    }
    return seg;
}

// Viết tắt tĩnh → chuỗi tìm trong tên tỉnh (đã bỏ dấu)
const _STATIC_PROV_ALIAS_KEYS = {
    'hcm': 'ho chi minh', 'tphcm': 'ho chi minh', 'tp hcm': 'ho chi minh', 'tp.hcm': 'ho chi minh',
    'sai gon': 'ho chi minh', 'saigon': 'ho chi minh', 'sg': 'ho chi minh',
    'hn': 'ha noi', 'ha noi': 'ha noi', 'hanoi': 'ha noi',
    'dn': 'da nang', 'da nang': 'da nang', 'danang': 'da nang',
    'dnai': 'dong nai', 'dong nai': 'dong nai',
    'hp': 'hai phong', 'hai phong': 'hai phong',
    'ct': 'can tho', 'can tho': 'can tho',
    'ag': 'an giang', 'an giang': 'an giang',
    'bg': 'bac giang', 'bac giang': 'bac giang',
    'bn': 'bac ninh', 'bac ninh': 'bac ninh',
    'bd': 'binh duong', 'binh duong': 'binh duong',
    'bp': 'binh phuoc', 'binh phuoc': 'binh phuoc',
    'bt': 'binh thuan', 'binh thuan': 'binh thuan',
    'brvt': 'ba ria', 'br vt': 'ba ria', 'vung tau': 'vung tau', 'br-vt': 'ba ria',
    'bl': 'bac lieu', 'bac lieu': 'bac lieu',
    'ben tre': 'ben tre',
    'cb': 'cao bang', 'cao bang': 'cao bang',
    'cm': 'ca mau', 'ca mau': 'ca mau',
    'db': 'dien bien', 'dien bien': 'dien bien',
    'dl': 'dak lak', 'daklak': 'dak lak', 'dac lac': 'dak lak',
    'dno': 'dak nong', 'dak nong': 'dak nong',
    'dt': 'dong thap', 'dong thap': 'dong thap',
    'gl': 'gia lai', 'gia lai': 'gia lai',
    'hb': 'hoa binh', 'hoa binh': 'hoa binh',
    'hag': 'ha giang', 'ha giang': 'ha giang',
    'hnam': 'ha nam', 'ha nam': 'ha nam',
    'ht': 'ha tinh', 'ha tinh': 'ha tinh',
    'hd': 'hai duong', 'hai duong': 'hai duong',
    'haug': 'hau giang', 'hau giang': 'hau giang',
    'hy': 'hung yen', 'hung yen': 'hung yen',
    'kh': 'khanh hoa', 'khanh hoa': 'khanh hoa',
    'kg': 'kien giang', 'kien giang': 'kien giang',
    'kt': 'kon tum', 'kon tum': 'kon tum',
    'lc': 'lao cai', 'lao cai': 'lao cai',
    'lb': 'lai chau', 'lai chau': 'lai chau',
    'ld': 'lam dong', 'lam dong': 'lam dong',
    'ls': 'lang son', 'lang son': 'lang son',
    'la': 'long an', 'long an': 'long an',
    'nd': 'nam dinh', 'nam dinh': 'nam dinh',
    'na': 'nghe an', 'nghe an': 'nghe an',
    'nb': 'ninh binh', 'ninh binh': 'ninh binh',
    'nt': 'ninh thuan', 'ninh thuan': 'ninh thuan',
    'pt': 'phu tho', 'phu tho': 'phu tho',
    'py': 'phu yen', 'phu yen': 'phu yen',
    'qb': 'quang binh', 'quang binh': 'quang binh',
    'qnam': 'quang nam', 'quang nam': 'quang nam',
    'qng': 'quang ngai', 'quang ngai': 'quang ngai',
    'qn': 'quang ninh', 'quang ninh': 'quang ninh',
    'qt': 'quang tri', 'quang tri': 'quang tri',
    'sl': 'son la', 'son la': 'son la',
    'st': 'soc trang', 'soc trang': 'soc trang',
    'tn': 'thai nguyen', 'thai nguyen': 'thai nguyen',
    'tb': 'thai binh', 'thai binh': 'thai binh',
    'th': 'thanh hoa', 'thanh hoa': 'thanh hoa',
    'tth': 'hue', 'thua thien hue': 'hue', 'hue': 'hue',
    'tg': 'tien giang', 'tien giang': 'tien giang',
    'tninh': 'tay ninh', 'tay ninh': 'tay ninh',
    'tv': 'tra vinh', 'tra vinh': 'tra vinh',
    'tq': 'tuyen quang', 'tuyen quang': 'tuyen quang',
    'vl': 'vinh long', 'vinh long': 'vinh long',
    'vp': 'vinh phuc', 'vinh phuc': 'vinh phuc',
    'yb': 'yen bai', 'yen bai': 'yen bai',
    'bdinh': 'binh dinh', 'binh dinh': 'binh dinh',
};

// Viết tắt quận/huyện cũ → tên lõi (nhiều tên quận cũ trùng phường/xã mới)
const _LEGACY_AREA_HINTS = {
    'g/vap': 'go vap', 'b/thanh': 'binh thanh', 'b/th': 'binh thanh',
    't/duc': 'thu duc', 'b/chanh': 'binh chanh', 'h/mon': 'hoc mon',
    'c/gio': 'can gio', 'p/nhuan': 'phu nhuan', 'b/t': 'binh tan', 'b/tan': 'binh tan',
    'tdm': 'thu dau mot', 'bmt': 'buon ma thuot',
};

const _CENTRAL_PROV_IDS = new Set(['01', '30', '12', '05', '32']);
const _LEGACY_HCM_BARE = new Set([
    'go vap', 'binh thanh', 'thu duc', 'binh chanh', 'hoc mon', 'can gio',
    'phu nhuan', 'binh tan', 'thu dau mot', 'binh duong', 'phu loi', 'ba ria',
    'vung tau', 'phu my', 'quan 1', 'quan 2', 'quan 3', 'quan 4', 'quan 5',
    'quan 6', 'quan 7', 'quan 8', 'quan 9', 'quan 10', 'quan 11', 'quan 12',
]);

const _NOISE_RE = /\b(noi dai|keo dai|mo rong|viet nam|vietnam|n\u1ed1i d\u00e0i|k\u00e9o d\u00e0i|m\u1edf r\u1ed9ng)\b/gi;
const _SUBWARD_RE = /\b(\u1ea5p|\u1ea1p|ap|x\u00f3m|xom|th\u00f4n|thon|t\u1ed5 d\u00e2n ph\u1ed1|to dan pho|t\u1ed5|to|kh\u00f3m|khom|khu ph\u1ed1|khu pho|tdp|ng\u00f5|ngo|h\u1ebem|hem)\s+(\d[\w/]*)\b/gi;

const _UNI_LETTER = /[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]/;

function _expandPfNumber(m, num, offset, str) {
    if (arguments.length === 5) {
        num = arguments[2];
        offset = arguments[3];
        str = arguments[4];
    }
    if (offset > 0 && _UNI_LETTER.test(str[offset - 1])) return m;
    return 'Ph\u01b0\u1eddng ' + num;
}

function _expandQNumber(m, num, offset, str) {
    if (offset > 0 && _UNI_LETTER.test(str[offset - 1])) return m;
    return 'Qu\u1eadn ' + num;
}

function _findProvinceByWardNeedle(needle, data) {
    const cn = _nn(needle);
    if (!cn) return null;
    const matches = [];
    for (const prov of data) {
        for (const ward of (prov.Wards || [])) {
            for (const label of _wardLabels(ward)) {
                const score = _scoreItemMatch(cn, _bare(label));
                if (score >= 0.88) matches.push({ province: prov, score });
            }
        }
    }
    if (!matches.length) return null;
    matches.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (_CENTRAL_PROV_IDS.has(b.province.Id) ? 1 : 0) - (_CENTRAL_PROV_IDS.has(a.province.Id) ? 1 : 0);
    });
    return matches[0].province;
}

function _buildProvinceAliasMap(data) {
    if (_provinceAliasMap) return _provinceAliasMap;
    const map = new Map();
    const add = (key, prov) => {
        const k = _nn(key);
        if (k && k.length >= 1 && !map.has(k)) map.set(k, prov);
    };
    const provMatchesNeedle = (prov, needle) => {
        const pn = _nn(prov.Name);
        const pb = _bare(prov.Name);
        return pn.includes(needle) || pb.includes(needle) || needle.includes(pb);
    };
    for (const prov of data) {
        add(prov.Name, prov);
        add(_bare(prov.Name), prov);
        const short = prov.Name.replace(/^(Thành phố|Tỉnh)\s+/i, '');
        add(short, prov);
        add(_bare(short), prov);
    }
    for (const [alias, needle] of Object.entries(_STATIC_PROV_ALIAS_KEYS)) {
        let found = null;
        for (const prov of data) {
            if (provMatchesNeedle(prov, needle)) { found = prov; break; }
        }
        if (!found) found = null; // không resolve alias tĩnh qua tên phường (vd "nam dinh")
        if (found) add(alias, found);
    }
    _provinceAliasMap = map;
    return map;
}

function _wardLabels(ward) {
    const labels = [ward.Name];
    if (ward.ShortName) labels.push(ward.ShortName);
    return labels;
}

function _scoreItemMatch(cn, iN) {
    if (cn === iN || _bareNumericEqual(cn, iN)) return 1;
    if (cn.length >= 2 && iN.includes(cn)) return cn.length / iN.length * 0.95;
    if (iN.length >= 2 && cn.includes(iN)) return iN.length / cn.length * 0.90;

    // Đa từ: từ cuối khác nhau rõ (vd "dong cao" ≠ "dong da") → không cho fuzzy cao
    const ct = cn.split(/\s+/).filter(Boolean);
    const it = iN.replace(/^(phuong|xa|thi tran|tt|p|f)\s+/i, '').split(/\s+/).filter(Boolean);
    if (ct.length >= 2 && it.length >= 2) {
        const lastC = ct[ct.length - 1];
        const lastI = it[it.length - 1];
        if (lastC.length >= 2 && lastI.length >= 2) {
            const lastMax = Math.max(lastC.length, lastI.length);
            const lastSim = 1 - levenshteinDistance(lastC, lastI) / lastMax;
            if (lastSim < 0.8) return Math.min(0.55, lastSim);
        }
    }

    const maxL = Math.max(cn.length, iN.length);
    if (Math.abs(cn.length - iN.length) <= maxL * 0.5) {
        return 1 - levenshteinDistance(cn, iN) / maxL;
    }
    return 0;
}

function _sameBareAsProvince(seg, province) {
    return !!(province && seg && _bare(seg) === _bare(province.Name));
}

/** Từ đơn lẻ trùng một phần tên tỉnh (vd "Bình" trong "Ninh Bình") — không dùng để khớp phường. */
function _isProvinceNameFragment(seg, province) {
    if (!seg || !province) return false;
    if (_sameBareAsProvince(seg, province)) return true;
    const sb = _bare(seg);
    if (!sb || sb.length < 2) return false;
    return _bare(province.Name).split(/\s+/).some(function (p) {
        return p.length >= 2 && p === sb;
    });
}

/** Bật log chi tiết trong DevTools: window.ADDR_PARSE_DEBUG = true */
function _addrDbg(step, detail) {
    if (typeof window !== 'undefined' && window.ADDR_PARSE_DEBUG) {
        console.log('[parseAddress:v3]', step, detail);
    }
}

function _matchWard(cand, wards, thr, province) {
    if (!cand || !wards?.length) return null;
    const cn = _bare(cand);
    if (!cn || /^\d+$/.test(cn)) return null;
    if (province && _sameBareAsProvince(cand, province)) {
        _addrDbg('skip ward (same as province name)', { cand, province: province.Name });
        return null;
    }
    if (province && _isProvinceNameFragment(cand, province)) {
        _addrDbg('skip ward (province name fragment)', { cand, province: province.Name });
        return null;
    }
    let best = null, bScore = 0;
    const top = [];
    for (const ward of wards) {
        for (const label of _wardLabels(ward)) {
            const iN = _bare(label);
            const score = _scoreItemMatch(cn, iN);
            if (score >= thr - 0.05) top.push({ ward: ward.Name, label, score: +score.toFixed(3) });
            if (score > bScore && score >= thr) { best = ward; bScore = score; }
        }
    }
    if (typeof window !== 'undefined' && window.ADDR_PARSE_DEBUG && top.length) {
        top.sort(function (a, b) { return b.score - a.score; });
        _addrDbg('matchWard', { cand, thr, top: top.slice(0, 5), picked: best ? best.Name : null });
    }
    return best;
}

function _globalWard(cand, data, province, thr) {
    if (!cand) return null;
    const cn = _bare(cand);
    if (!cn || /^\d+$/.test(cn)) return null;

    const hcm = province?.Id === '30' ? province : data.find(function (p) { return p.Id === '30'; });
    if (hcm && _LEGACY_HCM_BARE.has(cn)) {
        const w = _matchWard(cand, hcm.Wards, thr, hcm);
        if (w) return { ward: w, province: hcm };
    }

    const matches = [];
    for (const prov of (province ? [province] : data)) {
        for (const ward of (prov.Wards || [])) {
            for (const label of _wardLabels(ward)) {
                const score = _scoreItemMatch(cn, _bare(label));
                if (score >= thr) matches.push({ ward, province: prov, score });
            }
        }
    }
    if (!matches.length) return null;
    matches.sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return (_CENTRAL_PROV_IDS.has(b.province.Id) ? 1 : 0) - (_CENTRAL_PROV_IDS.has(a.province.Id) ? 1 : 0);
    });
    return { ward: matches[0].ward, province: matches[0].province };
}

function _findWardByHint(hint, data, province, thr) {
    if (!hint) return null;
    if (province) {
        const w = _matchWard(hint, province.Wards, thr, province);
        if (w) return { ward: w, province };
    }
    return _globalWard(hint, data, province, thr);
}

function _extractLegacyAreaHints(text) {
    const hints = [];
    text.replace(/\b([\w\u00C0-\u024F\u1E00-\u1EFF]+)\/([\w\u00C0-\u024F\u1E00-\u1EFF]+)\b/g, function (m) {
        const k = _nn(m).replace(/\s/g, '/');
        const mapped = _LEGACY_AREA_HINTS[k] || _LEGACY_AREA_HINTS[m.toLowerCase()];
        if (mapped) hints.push(mapped);
        return m;
    });
    for (const abbr of Object.keys(_LEGACY_AREA_HINTS)) {
        if (abbr.includes('/')) continue;
        const escaped = abbr.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
        const re = new RegExp('\\b' + escaped + '\\b', 'gi');
        if (re.test(text)) hints.push(_LEGACY_AREA_HINTS[abbr]);
    }
    return hints;
}

function _expand(text, data) {
    _buildProvinceAliasMap(data);
    text = text.normalize('NFC').replace(/\u00A0/g, ' ');
    text = text.replace(/,(\S)/g, ', $1');
    text = text.replace(/\s*[-\u2013\u2014|]\s*/g, ', ');
    text = text.replace(/([A-Za-z\u00C0-\u024F\u1E00-\u1EFF]{3,})\.\s*([A-Za-z\u00C0-\u024F\u1E00-\u1EFF])/g, '$1, $2');

    text = text.replace(/\b([PF])\.?(\d{1,2})(?=[qQ]\.?\d{1,2}\b)/gi, function (m, _p, n, offset, str) {
        return _expandPfNumber(m, n, offset, str) + ' ';
    });
    text = text.replace(/\bQ\.?\s*(\d{1,2})\b/gi, _expandQNumber);
    text = text.replace(/\b[PF]\.?\s*(\d{1,2})\b/gi, _expandPfNumber);

    text = text.replace(
        /\b(?:tp\.?|th\u00e0nh ph\u1ed1|thanh pho)\s+(hcm|tphcm|sg|sai\s*gon|saigon)\b/gi,
        '$1'
    );
    text = text.replace(/\b[pP]\.\s?([A-Z][a-zA-Z\u00C0-\u024F]*(?:\s+[A-Z][a-zA-Z\u00C0-\u024F]*){0,2})\b/g,
        'Ph\u01b0\u1eddng $1');

    const ROMAN = { i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' };
    text = text.replace(/\b(ph\u01b0\u1eddng|phuong)\s+(x{0,1}i{0,3}|i?x|v?i{0,3})\b/gi, function (m, kw, rn) {
        const n = ROMAN[rn.toLowerCase()];
        return n ? kw + ' ' + n : m;
    });

    text = text.replace(_NOISE_RE, ' ');
    text = text.replace(/\b\d{5,6}\b/g, ' ');

    const aliasMap = _buildProvinceAliasMap(data);
    const tokens = text.split(/\s+/);
    const protectedIdx = new Set();
    for (let j = 0; j < tokens.length - 1; j++) {
        const tk = tokens[j].replace(/[,;.:]+$/g, '');
        if (/^(tinh|t\u1ec9nh)$/i.test(tk)) {
            for (let k = 1; k <= Math.min(3, tokens.length - j - 1); k++) protectedIdx.add(j + k);
        }
        if (/^(phuong|ph\u01b0\u1eddng|xa|x\u00e3|thi tran|th\u1ecb tr\u1ea5n|tt)$/i.test(tk)) {
            for (let k = 1; k <= Math.min(2, tokens.length - j - 1); k++) protectedIdx.add(j + k);
        }
        if (/^(\u1ea5p|\u1ea1p|ap|x\u00f3m|xom|th\u00f4n|thon|khu ph\u1ed1|khu pho|tdp|ng\u00f5|ngo)$/i.test(tk)) {
            for (let k = 1; k <= Math.min(2, tokens.length - j - 1); k++) protectedIdx.add(j + k);
        }
    }
    const out = [];
    let i = 0;
    while (i < tokens.length) {
        let matched = false;
        if (!protectedIdx.has(i)) {
            for (let n = Math.min(3, tokens.length - i); n >= 1; n--) {
                if (n > 1 && tokens.slice(i, i + n - 1).some(function (t) { return t.indexOf(',') !== -1; })) continue;
                if (tokens.slice(i, i + n).some(function (_, off) { return protectedIdx.has(i + off); })) continue;
                const key = _nn(tokens.slice(i, i + n).join(' '));
                if (/^\d+$/.test(key)) continue;
                const prov = aliasMap.get(key);
                if (prov) {
                    out.push(prov.Name);
                    i += n;
                    matched = true;
                    break;
                }
            }
        }
        if (!matched) { out.push(tokens[i]); i++; }
    }
    return out.join(' ').replace(/\s+/g, ' ').trim();
}

function _extractSubward(text) {
    const parts = [];
    const cleaned = text.replace(_SUBWARD_RE, function (m) { parts.push(m.trim()); return ' '; })
        .replace(/\s+/g, ' ').trim();
    return { cleaned, subward: parts.join(', ') };
}

var _ADMIN_LA = '(?='
    + '\\s*(?:$|[,.])'
    + '|\\s+(?:'
    + 'tinh|t\u1ec9nh'
    + '|thanh\\s+pho|th\u00e0nh\\s+ph\u1ed1|tp\\.?'
    + '|quan|qu\u1eadn'
    + '|huyen|huy\u1ec7n'
    + '|thi\\s+xa|th\u1ecb\\s+x\u00e3|tx\\.?'
    + '|phuong|ph\u01b0\u1eddng'
    + '|xa|x\u00e3'
    + '|thi\\s+tran|th\u1ecb\\s+tr\u1ea5n|tt\\.?'
    + ')(?:\\s|$|[,.])'
    + ')';

function _anchors(text) {
    const a = { province: null, legacy: [], ward: null };
    let m;

    var reP = new RegExp('(?:^|[,.]\\s*)(?:t\u1ec9nh|tinh)\\s+([^,\\n]{1,30}?)' + _ADMIN_LA, 'gi');
    reP.lastIndex = 0;
    while ((m = reP.exec(text))) a.province = m[1].trim();
    if (!a.province) {
        var rePEnd = /\b(?:t\u1ec9nh|tinh)\s+([^,\n]{1,30}?)\s*$/i;
        m = rePEnd.exec(text);
        if (m) a.province = m[1].trim();
    }

    const tpCands = [];
    var reTP = new RegExp('\\b(?:th\u00e0nh\\s+ph\u1ed1|thanh\\s+pho|tp\\.?)\\s+([^,\\n]{1,25}?)' + _ADMIN_LA, 'gi');
    reTP.lastIndex = 0;
    while ((m = reTP.exec(text))) tpCands.push(m[1].trim().split(/\s*,/)[0].trim());

    var reD = new RegExp('\\b(?:qu\u1eadn|quan|huy\u1ec7n|huyen|th\u1ecb\\s+x\u00e3|thi\\s+xa|tx\\.?)\\s+([^,\\n]{1,25}?)' + _ADMIN_LA, 'gi');
    reD.lastIndex = 0;
    while ((m = reD.exec(text))) a.legacy.push(m[1].trim().split(/\s*,/)[0].trim());

    var reW = new RegExp('\\b(?:ph\u01b0\u1eddng|phuong|th\u1ecb\\s+tr\u1ea5n|thi\\s+tran|tt\\.?|(?<!\\bthi\\s)(?<!\\bth\u1ecb\\s)(?:x\u00e3|xa))\\s+([^,\\n]{1,25}?)' + _ADMIN_LA, 'gi');
    reW.lastIndex = 0;
    while ((m = reW.exec(text))) {
        if (a.ward) break;
        let wText = m[1].trim().split(/\s*,/)[0].trim();
        const wWords = wText.split(/\s+/);
        if (wWords.length > 3) wText = wWords.slice(0, 2).join(' ');
        if (/^\d+$/.test(wWords[0]) && wWords.length > 1) {
            a.legacy.push(wWords.slice(1).join(' '));
        } else if (!/^\d+$/.test(_bare(wText))) {
            a.ward = wText;
        }
    }

    const centralCities = new Set(['ho chi minh', 'ha noi', 'da nang', 'hai phong', 'can tho', 'hue']);
    for (const cand of tpCands) {
        if (centralCities.has(_bare(cand))) a.province = cand;
        else a.legacy.push(cand);
    }
    return a;
}

function _match(cand, items, thr) {
    if (!cand || !items?.length) return null;
    const cn = _bare(cand);
    if (!cn) return null;
    let best = null, bScore = 0;
    for (const item of items) {
        const score = _scoreItemMatch(cn, _bare(item.Name));
        if (score > bScore && score >= thr) { best = item; bScore = score; }
    }
    return best;
}

var _provFromEndText = null;
function _inferProvFromEnd(text, data, thr) {
    _provFromEndText = null;
    const aliasMap = _buildProvinceAliasMap(data);
    let words = text.split(/[\s,]+/).filter(function (w) { return w.length > 1; });
    // Bỏ badge số đuôi (vd "09") trước khi lấy tỉnh cuối chuỗi
    while (words.length > 1 && /^\d{1,2}$/.test(words[words.length - 1])) {
        words = words.slice(0, -1);
    }
    // Peel tên người dính sau tỉnh (vd "... Hà Nội Nguyễn Văn Yên")
    for (let peel = 0; peel <= Math.min(4, Math.max(0, words.length - 1)); peel++) {
        const use = words.slice(0, words.length - peel);
        for (let n = Math.min(3, use.length); n >= 1; n--) {
            const candidate = use.slice(-n).join(' ');
            const fromAlias = aliasMap.get(_nn(candidate));
            if (fromAlias) {
                _provFromEndText = candidate;
                return fromAlias;
            }
            const p = _match(candidate, data, thr);
            if (p) {
                _provFromEndText = candidate;
                return p;
            }
            const fromWard = _findProvinceByWardNeedle(candidate, data);
            if (fromWard) {
                _provFromEndText = candidate;
                return fromWard;
            }
        }
    }
    return null;
}

function _collectLegacyHints(anc, rawText) {
    const primary = anc.ward ? [anc.ward] : [];
    const secondary = [];
    if (anc.legacy?.length) secondary.push(...anc.legacy);
    if (rawText) secondary.push(..._extractLegacyAreaHints(rawText));
    const uniqueSecondary = [...new Set(secondary.filter(Boolean))];
    uniqueSecondary.sort(function (a, b) {
        const ba = _bare(a), bb = _bare(b);
        const aNum = /^\d+$/.test(ba) ? 1 : 0;
        const bNum = /^\d+$/.test(bb) ? 1 : 0;
        if (aNum !== bNum) return aNum - bNum;
        return bb.length - ba.length;
    });
    return [...primary, ...uniqueSecondary.filter(function (h) { return !primary.includes(h); })];
}

function _fallback2(text, data) {
    const out = { province: null, ward: null };
    const segs = text.split(',').map(function (s) { return s.trim(); }).filter(Boolean);

    if (segs.length >= 2) {
        for (let pi = segs.length - 1; pi >= 0; pi--) {
            const p = _match(segs[pi], data, 0.80);
            if (!p) continue;
            out.province = p;
            for (let wi = pi - 1; wi >= 0; wi--) {
                if (_isProvinceNameFragment(segs[wi], p)) continue;
                const w = _matchWard(_stripTrailingProvinceSuffix(segs[wi], p), p.Wards, 0.73, p);
                if (w) { out.ward = w; break; }
            }
            return out;
        }
    }

    // Tách cả dấu phẩy — tránh ghép xuyên segment (vd "linh, Thành" → Vĩnh Thanh)
    const words = text.split(/[\s,]+/).filter(Boolean);
    for (let n = Math.min(3, words.length); n >= 1; n--) {
        for (let s = words.length - n; s >= 0; s--) {
            const p = _match(words.slice(s, s + n).join(' '), data, 0.82);
            if (!p) continue;
            out.province = p;
            const rem = words.slice(0, s).concat(words.slice(s + n));
            for (let wn = Math.min(3, rem.length); wn >= 1; wn--) {
                for (let ws = rem.length - wn; ws >= 0; ws--) {
                    const cand = rem.slice(ws, ws + wn).join(' ');
                    if (_WARD_SCAN_SKIP_TOKENS.has(_nn(cand))) continue;
                    if (/\b(?:thanh pho|thanh|pho|tinh|tp)\b/i.test(_nn(cand)) && wn >= 2) continue;
                    if (_isProvinceNameFragment(cand, p)) continue;
                    const w = _matchWard(
                        _stripTrailingProvinceSuffix(cand, p),
                        p.Wards, 0.75, p
                    );
                    if (w) { out.ward = w; return out; }
                }
            }
            return out;
        }
    }

    for (let wn = Math.min(3, words.length); wn >= 1; wn--) {
        for (let ws = words.length - wn; ws >= 0; ws--) {
            const cand = words.slice(ws, ws + wn).join(' ');
            if (_WARD_SCAN_SKIP_TOKENS.has(_nn(cand))) continue;
            if (/\b(?:thanh pho|thanh|pho|tinh|tp)\b/i.test(_nn(cand)) && wn >= 2) continue;
            const r = _globalWard(cand, data, null, 0.78);
            if (r) { out.ward = r.ward; out.province = r.province; return out; }
        }
    }
    return out;
}

function _partialWardFallback(text, province, hints) {
    for (const hint of hints) {
        const w = _matchWard(hint, province.Wards, 0.73, province);
        if (w) return w;
    }
    const segs = text.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    for (let si = segs.length - 1; si >= 0; si--) {
        if (_isProvinceNameFragment(segs[si], province)) continue;
        const w = _matchWard(_stripTrailingProvinceSuffix(segs[si], province), province.Wards, 0.73, province);
        if (w) return w;
    }
    // Tách cả dấu phẩy — tránh ghép xuyên segment (vd "Cao, Thành" → Đại Thanh)
    const words = text.split(/[\s,]+/).filter(Boolean);
    for (let n = Math.min(3, words.length); n >= 1; n--) {
        for (let i = words.length - n; i >= 0; i--) {
            const cand = words.slice(i, i + n).join(' ');
            if (_isProvinceNameFragment(cand, province)) continue;
            if (/\b(?:thanh pho|thanh|pho|tinh|tp)\b/i.test(_nn(cand)) && n >= 2) continue;
            const w = _matchWard(_stripTrailingProvinceSuffix(cand, province), province.Wards, 0.75, province);
            if (w) return w;
        }
    }
    return null;
}

// So sánh 2 ứng viên phường: exact thắng fuzzy; trong exact ưu tiên có keyword "phường/xã",
// rồi window dài hơn (khớp nhiều chữ hơn), rồi gần cuối (sát tỉnh) hơn.
function _betterWardCand(a, b) {
    if (!b) return true;
    if (a.exact !== b.exact) return a.exact > b.exact;
    if (a.exact) {
        if (a.kw !== b.kw) return a.kw > b.kw;
        if (a.len !== b.len) return a.len > b.len;
        return a.pos > b.pos;
    }
    if (Math.abs(a.score - b.score) > 0.03) return a.score > b.score;
    if (a.kw !== b.kw) return a.kw > b.kw;
    if (a.len !== b.len) return a.len > b.len;
    return a.pos > b.pos;
}

const _WARD_KW = new Set(['phuong', 'p', 'f', 'xa', 'x', 'thi tran', 'tt', 'tdp', 'kp', 'khu pho', 'khom', 'ap']);
/** Token hành chính / mảnh tên tỉnh — không dùng làm ứng viên phường đơn lẻ */
const _WARD_SCAN_SKIP_TOKENS = new Set([
    'thanh', 'pho', 'tinh', 'tp', 'quan', 'huyen', 'thi', 'xa', 'phuong', 'p', 'f', 'tt',
    'thanh pho', 'thi xa', 'thi tran',
]);

/**
 * Ưu tiên tuyệt đối: tên phường/xã xuất hiện nguyên cụm trong text (vd "mê linh").
 * Tránh fuzzy "Đông Cao"→Đống Đa / nhiễu "Thành"→Vĩnh Thanh.
 */
function _findExactWardMention(text, province) {
    if (!province?.Wards?.length || !text) return null;
    const hay = ` ${_nn(text)} `;
    let best = null;
    for (const ward of province.Wards) {
        for (const label of _wardLabels(ward)) {
            const bare = _bare(label);
            if (!bare || bare.length < 3) continue;
            const needle = ` ${bare} `;
            if (!hay.includes(needle)) continue;
            const len = bare.split(/\s+/).filter(Boolean).length;
            if (!best || len > best.len) best = { ward, len, bare };
        }
    }
    return best ? best.ward : null;
}

/**
 * Quét toàn chuỗi tìm phường/xã khớp tốt nhất TRONG MỘT TỈNH.
 * Bỏ qua dấu phẩy (chạy cả khi không có dấu ngăn cách), window 1..4 từ,
 * ưu tiên khớp CHÍNH XÁC (không return sớm ở window fuzzy nhiễu).
 * Trả về { ward, exact, score } hoặc null.
 */
function _bestWardInProvince(text, province) {
    if (!province || !province.Wards || !province.Wards.length || !text) return null;
    const rawTokens = text.split(/\s+/).filter(Boolean);
    const toks = [];
    for (let i = 0; i < rawTokens.length; i++) {
        const bare = _nn(rawTokens[i]);
        if (!bare) continue;
        if (_WARD_SCAN_SKIP_TOKENS.has(bare)) continue;
        const prev = i > 0 ? _nn(rawTokens[i - 1]) : '';
        let afterKw = _WARD_KW.has(prev);
        // "thị xã" là huyện cũ (không phải phường) → không tính là keyword phường/xã
        if (afterKw && (prev === 'xa' || prev === 'x')) {
            const prev2 = i > 1 ? _nn(rawTokens[i - 2]) : '';
            if (prev2 === 'thi') afterKw = false;
        }
        toks.push({ bare, afterKw });
    }
    const N = toks.length;
    if (!N) return null;
    const maxW = Math.min(4, N);
    let best = null;
    for (let n = 1; n <= maxW; n++) {
        for (let i = 0; i + n <= N; i++) {
            const cand = toks.slice(i, i + n).map(t => t.bare).join(' ');
            if (!cand || /^\d+$/.test(cand)) continue;
            if (_WARD_SCAN_SKIP_TOKENS.has(cand)) continue;
            if (_isProvinceNameFragment(cand, province)) continue;
            let wWard = null, wScore = 0;
            for (const ward of province.Wards) {
                for (const label of _wardLabels(ward)) {
                    const s = _scoreItemMatch(cand, _bare(label));
                    if (s > wScore) { wScore = s; wWard = ward; }
                }
            }
            if (!wWard) continue;
            const exact = wScore >= 0.999 ? 1 : 0;
            if (!exact && wScore < 0.80) continue;
            const cur = { ward: wWard, score: wScore, len: n, pos: i, kw: toks[i].afterKw ? 1 : 0, exact };
            if (_betterWardCand(cur, best)) best = cur;
        }
    }
    return best ? { ward: best.ward, exact: best.exact === 1, score: best.score } : null;
}

function _extractStreet(expanded, province, ward, subward) {
    let s = expanded;
    s = s.replace(/\b(?:t\u1ec9nh|tinh)\s+[^,]+/gi, ' ');
    s = s.replace(/\b(?:th\u00e0nh ph\u1ed1|thanh pho|tp\.?)\s+[^,]+/gi, ' ');
    s = s.replace(/\b(?:qu\u1eadn|quan|huy\u1ec7n|huyen|th\u1ecb x\u00e3|thi xa|tx\.?)\s+[^,]+/gi, ' ');
    s = s.replace(/\b(?:ph\u01b0\u1eddng|phuong|x\u00e3|xa|th\u1ecb tr\u1ea5n|thi tran|tt\.?)\s+[^,]+/gi, ' ');
    function safe(n) { return n ? n.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&') : ''; }
    if (province) s = s.replace(new RegExp(safe(province.Name), 'gi'), ' ');
    if (ward) {
        s = s.replace(new RegExp(safe(ward.Name), 'gi'), ' ');
        if (ward.ShortName) s = s.replace(new RegExp(safe(ward.ShortName), 'gi'), ' ');
    }
    if (subward) s = s.replace(_SUBWARD_RE, ' ');
    s = s.replace(/\b[QPF]\.\s*/gi, ' ');
    s = s.replace(/[,\s]+$/, '').replace(/^[,\s]+/, '').replace(/,\s*,+/g, ',').replace(/\s+/g, ' ').trim();
    return subward ? subward + (s ? ', ' + s : '') : s;
}

/**
 * parseAddress v3 — 2-level cascade (Tỉnh/TP → Phường/Xã)
 */
async function parseAddress(addressText, customerHint) {
    if (customerHint === undefined) customerHint = null;
    const result = { street: '', ward: null, district: null, province: null, confidence: 'low', suggestions: [], warnings: [] };
    const data = getVietnamAddressData();
    if (!data?.length || !addressText?.trim()) return result;

    _buildProvinceAliasMap(data);

    const expanded = _expand(addressText, data);
    const sw = _extractSubward(expanded);
    const cleaned = sw.cleaned;
    const subward = sw.subward;
    const anc = _anchors(cleaned);
    const legacyHints = _collectLegacyHints(anc, addressText);

    let province = null;
    let ward = null;

    if (anc.province) {
        const provNn = _nn(anc.province);
        if (/^(quan|huyen|thi xa|tx|phuong|xa|thi tran|tt)\s/.test(provNn) || /\//.test(anc.province)) {
            legacyHints.unshift(anc.province.replace(/^\S+\s+/, '').replace(/^[^/]+\//, ''));
            if (/\//.test(anc.province)) legacyHints.unshift(_LEGACY_AREA_HINTS[_nn(anc.province).replace(/\s/g, '/')] || _bare(anc.province));
            anc.province = null;
        } else {
            province = _match(anc.province, data, 0.78)
                || _buildProvinceAliasMap(data).get(_nn(anc.province))
                || _findProvinceByWardNeedle(anc.province, data);
            if (!province) legacyHints.unshift(anc.province);
        }
    }
    if (!province) province = _inferProvFromEnd(cleaned, data, 0.88);

    _addrDbg('1-normalize', { input: addressText, expanded, cleaned, anchors: anc, legacyHints });

    // Ưu tiên: tên xã/phường có nguyên văn trong địa chỉ (vd "mê linh") — chặn fuzzy nhiễu
    if (province && !ward) {
        ward = _findExactWardMention(cleaned, province) || _findExactWardMention(addressText, province);
        if (ward) _addrDbg('1a-exact-mention', { ward: ward.Name });
    }

    // Chỉ khớp anc.province như phường khi KHÔNG phải tên tỉnh (vd "Long An" trong Tây Ninh — OK; "Ninh Bình" — không)
    if (province && anc.province && !ward
        && _bare(anc.province) !== _bare(province.Name)
        && !_isProvinceNameFragment(anc.province, province)) {
        ward = _matchWard(anc.province, province.Wards, 0.78, province);
        _addrDbg('1b-province-anchor-as-ward', { ancProvince: anc.province, ward: ward?.Name || null });
    }

    const explicitProvinceName = anc.province ? _nn(anc.province) : '';
    for (const hint of legacyHints) {
        if (ward) break;
        if (explicitProvinceName && _nn(hint) === explicitProvinceName) {
            _addrDbg('2-hint-skip (same as province name)', hint);
            continue;
        }
        if (province && _sameBareAsProvince(hint, province)) {
            _addrDbg('2-hint-skip (bare province name)', hint);
            continue;
        }
        const r = _findWardByHint(hint, data, province, 0.75);
        _addrDbg('2-hint-try', { hint, province: province?.Name, result: r?.ward?.Name || null });
        if (r) {
            ward = r.ward;
            if (!province) province = r.province;
        }
    }

    // Quét khớp CHÍNH XÁC tên phường/xã trong tỉnh (ưu tiên hơn fuzzy/anchor) —
    // xử lý đúng địa chỉ mới 2 cấp kể cả khi không có dấu phẩy / không có chữ "phường".
    if (province) {
        // Bỏ tên tỉnh + tiền tố hành chính lẻ trước khi quét, tránh ghép xuyên biên
        // (vd "Long An" + "Tỉnh" → "An Tịnh"; "Nam Phước" + "Thành phố" → "Phước Thành").
        const safeProv = province.Name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
        const scanText = cleaned
            .replace(new RegExp(safeProv, 'gi'), ' ')
            .replace(/\b(?:t\u1ec9nh|tinh|th\u00e0nh ph\u1ed1|thanh pho|tp)\b/gi, ' ');
        const sc = _bestWardInProvince(scanText, province);
        if (sc && (sc.exact || !ward)) {
            ward = sc.ward;
            _addrDbg('2b-exact-scan', { ward: ward.Name, exact: sc.exact, score: sc.score });
        }
    }

    if (!province && !ward) {
        const fb = _fallback2(cleaned, data);
        province = fb.province;
        ward = fb.ward;
        _addrDbg('3-fallback2', { province: province?.Name, ward: ward?.Name });
    } else if (province && !ward) {
        ward = _partialWardFallback(cleaned, province, legacyHints);
        _addrDbg('4-partialWardFallback', { ward: ward?.Name });
    }

    if (province && !ward && _provFromEndText) {
        const alt = _partialWardFallback(cleaned, province, [_provFromEndText, ...legacyHints]);
        if (alt) ward = alt;
        _addrDbg('5-provFromEndFallback', { ward: ward?.Name });
    }

    if (!province && customerHint?.province_id) {
        province = data.find(function (p) { return p.Id === String(customerHint.province_id); }) || null;
    }
    if (province && !ward && customerHint?.ward_id) {
        ward = (province.Wards || []).find(function (w) { return w.Id === String(customerHint.ward_id); }) || null;
    }

    result.street = _extractStreet(expanded, province, ward, subward);
    result.province = province;
    result.ward = ward;
    result.confidence = province && ward ? 'high' : province ? 'medium' : 'low';

    console.log('\uD83D\uDCCD parseAddress v3:', {
        province: province ? province.Name : null,
        ward: ward ? ward.Name : null,
        wardId: ward ? ward.Id : null,
        street: result.street,
        confidence: result.confidence
    });
    _addrDbg('6-final', {
        province: province?.Name,
        ward: ward?.Name,
        wardId: ward?.Id,
        confidence: result.confidence
    });
    return result;
}

