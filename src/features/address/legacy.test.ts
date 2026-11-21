import { describe, expect, it } from 'vitest';
import rowsText from '../../../public/data/address-select.json?raw';
import mappingText from '../../../public/data/ward_mapping_2025.json?raw';
import { foldAddressText, type AddressSelectRow } from './parse';
import {
  buildLegacySelectTree,
  legacyCoverage,
  resolveLegacyManual,
  searchLegacyAddress,
} from './legacy';

const rows = JSON.parse(rowsText) as AddressSelectRow[];
const mapping = JSON.parse(mappingText) as Record<string, string>;

function wardNamed(provinceName: string, wardName: string): { provinceCode: string; wardCode: string } | null {
  const province = rows.find((row) => row[1] === provinceName);
  const ward = province?.[2].find((item) => item[1] === wardName);
  if (!province || !ward) return null;
  return { provinceCode: province[0], wardCode: ward[0] };
}

describe('đổi địa chỉ 3 cấp sang 2 cấp', () => {
  it('gắn được gần hết file ánh xạ vào xã mới', () => {
    const coverage = legacyCoverage(rows, mapping);
    expect(coverage.old).toBeGreaterThan(9900);
    expect(coverage.current).toBeGreaterThan(3000);
  });

  it('gõ không dấu đúng một xã cũ thì ra đúng xã mới', () => {
    const target = wardNamed('Thành phố Hà Nội', 'Xã Mê Linh');
    expect(target).toBeTruthy();
    for (const raw of [
      'trang viet',
      'xa trang viet',
      'xa tráng việt',
      'xa trang viet, huyen me linh, thanh pho ha noi',
      'xa trang viet huyen me linh ha noi',
    ]) {
      const result = searchLegacyAddress(rows, mapping, raw);
      expect(result.items.some((item) => item.wardCode === target?.wardCode), raw).toBe(true);
      expect(result.items[0]?.newText, raw).toMatch(/Mê Linh.*Hà Nội/);
    }
    const result = searchLegacyAddress(rows, mapping, 'trang viet');
    expect(result.more).toBe(false);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.oldText.toLowerCase()).toContain('tráng việt');
  });

  it('câu đủ xóm thôn huyện tỉnh giữ phần số nhà và không kéo xã chỉ trùng một từ', () => {
    const result = searchLegacyAddress(
      rows,
      mapping,
      'xóm 4, thôn Đông Cao, Xã Tráng Việt, huyện Mê Linh, Thành Phố Hà Nội',
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.newText).toBe('Xã Mê Linh · Thành phố Hà Nội');
    expect(result.items[0]?.line).toBe('xóm 4, thôn Đông Cao');
    expect(result.items[0]?.oldText.toLowerCase()).not.toContain('hùng việt');
  });

  it('HCM: đường trùng tên xã + huyện + thành phố (không phẩy) ra Xuân Thới Sơn', () => {
    const target = wardNamed('Thành phố Hồ Chí Minh', 'Xã Xuân Thới Sơn');
    expect(target).toBeTruthy();
    for (const raw of [
      '73/4 đường Xuân thới sơn 27 hóc môn thành phố hồ chí minh',
      '73/4 đường Xuân thới sơn 27 hóc môn thành phố hồ chí minh\n0961262866',
      'đường Xuân thới sơn 27 hóc môn thành phố hồ chí minh',
      'xuân thới sơn, hóc môn, thành phố hồ chí minh',
      'xuan thoi son hoc mon thanh pho ho chi minh',
    ]) {
      const result = searchLegacyAddress(rows, mapping, raw);
      expect(result.items.some((item) => item.wardCode === target?.wardCode), raw).toBe(true);
      expect(result.items[0]?.newText, raw).toMatch(/Xuân Thới Sơn.*Hồ Chí Minh/);
    }
    const withStreet = searchLegacyAddress(
      rows,
      mapping,
      '73/4 đường Xuân thới sơn 27 hóc môn thành phố hồ chí minh',
    );
    expect(withStreet.items[0]?.line.toLowerCase()).toMatch(/73\/4/);
  });

  it('viết tắt x./h. (kèm thôn, không dấu) vẫn ra Xã Mê Linh', () => {
    const target = wardNamed('Thành phố Hà Nội', 'Xã Mê Linh');
    expect(target).toBeTruthy();
    for (const raw of [
      'thôn đông cao, x.tráng việt, h.mê linh, hà nội',
      'thon dong cao, x.trang viet, h.me linh, ha noi',
      'x.tráng việt, h.mê linh, tp.hà nội',
      'X. Tráng Việt, H. Mê Linh, Hà Nội',
      'x/trang viet, h/me linh, ha noi',
    ]) {
      const result = searchLegacyAddress(rows, mapping, raw);
      expect(result.items.some((item) => item.wardCode === target?.wardCode), raw).toBe(true);
      expect(result.items[0]?.newText, raw).toMatch(/Mê Linh.*Hà Nội/);
    }
    const withHamlet = searchLegacyAddress(
      rows,
      mapping,
      'thôn đông cao, x.tráng việt, h.mê linh, hà nội',
    );
    expect(withHamlet.items[0]?.line.toLowerCase()).toContain('đông cao');
  });

  it('tên xã trùng nhiều nơi thì trả nhiều dòng, không gộp thành một', () => {
    const result = searchLegacyAddress(rows, mapping, 'tan thanh');
    expect(result.items.length).toBeGreaterThan(1);
    for (const item of result.items) {
      expect(foldAddressText(`${item.oldText} ${item.newText}`)).toContain('tan thanh');
    }
  });

  it('tiền tố «long thành» vẫn ra «long thành bắc» cùng các long thành exact', () => {
    const result = searchLegacyAddress(rows, mapping, 'long thành');
    expect(result.items.length).toBeGreaterThan(1);
    const bac = result.items.find((item) => /long thành bắc/i.test(item.oldText));
    expect(bac).toBeTruthy();
    expect(bac?.newText.toLowerCase()).toMatch(/long hoa|tây ninh/);
  });

  it('p5 Q8 và biến thể viết tắt mở thành phường 5 quận 8 HCM', () => {
    const target = wardNamed('Thành phố Hồ Chí Minh', 'Phường Chánh Hưng');
    expect(target).toBeTruthy();
    for (const raw of [
      '128/12A Bùi Minh Trực p5 Q8',
      '128/12A Bùi Minh Trực P.5 q.8',
      '128/12A Bùi Minh Trực ph 5, quận 8',
      'Bùi Minh Trực, phường 5, Q8',
    ]) {
      const result = searchLegacyAddress(rows, mapping, raw);
      expect(result.items, raw).toHaveLength(1);
      expect(result.items[0], raw).toMatchObject({
        provinceCode: target?.provinceCode,
        wardCode: target?.wardCode,
        newText: 'Phường Chánh Hưng · Thành phố Hồ Chí Minh',
      });
      if (/^\d/.test(raw.trim())) {
        expect(result.items[0]?.line.toLowerCase(), raw).toContain('bùi minh trực');
      }
    }
  });

  it('chỉ p5 không có quận thì không tự gắn HCM', () => {
    const result = searchLegacyAddress(rows, mapping, '12 Lê Lợi p5');
    expect(result.items.every((item) => !/chánh hưng/i.test(item.newText))).toBe(true);
  });

  it('chọn tay 3 cấp Tráng Việt / Mê Linh / Hà Nội ra Xã Mê Linh', () => {
    const target = wardNamed('Thành phố Hà Nội', 'Xã Mê Linh');
    expect(target).toBeTruthy();
    const tree = buildLegacySelectTree(mapping);
    expect(tree.provinces.some((name) => /hà nội/i.test(name))).toBe(true);
    const province = tree.provinces.find((name) => /hà nội/i.test(name));
    expect(province).toBeTruthy();
    const districts = tree.districts[province!];
    const district = districts?.find((name) => /mê linh/i.test(name));
    expect(district).toBeTruthy();
    const wards = tree.wards[`${province}\t${district}`];
    const ward = wards?.find((name) => /tráng việt/i.test(name));
    expect(ward).toBeTruthy();
    const hit = resolveLegacyManual(rows, mapping, {
      province: province!,
      district: district!,
      ward: ward!,
    });
    expect(hit).toMatchObject({
      provinceCode: target?.provinceCode,
      wardCode: target?.wardCode,
      newText: 'Xã Mê Linh · Thành phố Hà Nội',
    });
  });

  it('Thôn + dấu chấm dính + Thuỷ Nguyên Hải Phòng ra Phường Thủy Nguyên', () => {
    const target = wardNamed('Thành phố Hải Phòng', 'Phường Thủy Nguyên');
    expect(target).toBeTruthy();
    for (const raw of [
      'Thon 7 Trung Sơn.Ngũ Lão . Thuỷ Nguyên,Hải Phòng b',
      'Thôn 7 Trung Sơn, Ngũ Lão, Thuỷ Nguyên, Hải Phòng',
      'Ngũ Lão, Thuỷ Nguyên, Hải Phòng',
    ]) {
      const result = searchLegacyAddress(rows, mapping, raw);
      expect(result.items, raw).toHaveLength(1);
      expect(result.items[0], raw).toMatchObject({
        provinceCode: target?.provinceCode,
        wardCode: target?.wardCode,
        newText: 'Phường Thủy Nguyên · Thành phố Hải Phòng',
      });
    }
    const withStreet = searchLegacyAddress(
      rows,
      mapping,
      'Thon 7 Trung Sơn.Ngũ Lão . Thuỷ Nguyên,Hải Phòng b',
    );
    expect(withStreet.items[0]?.line.toLowerCase()).toMatch(/thon 7|trung sơn/);
  });

  it('xã đồng đăng Lạng Sơn không nhầm thành đông kinh', () => {
    const target = wardNamed('Tỉnh Lạng Sơn', 'Xã Đồng Đăng');
    const wrong = wardNamed('Tỉnh Lạng Sơn', 'Phường Đông Kinh');
    expect(target && wrong).toBeTruthy();
    const result = searchLegacyAddress(
      rows,
      mapping,
      'đc nhà văn hoá thôn còn pheo xã đồng đăng tỉnh lạng sơn',
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      provinceCode: target?.provinceCode,
      wardCode: target?.wardCode,
      newText: 'Xã Đồng Đăng · Tỉnh Lạng Sơn',
    });
    expect(result.items[0]?.wardCode).not.toBe(wrong?.wardCode);
    expect(result.items[0]?.line.toLowerCase()).toContain('thôn còn pheo');
  });

  it('tin chat dạng Long Bình - An Phú - An Giang kèm SĐT và ghi chú', () => {
    const target = wardNamed('Tỉnh An Giang', 'Xã Khánh Bình');
    expect(target).toBeTruthy();
    const result = searchLegacyAddress(
      rows,
      mapping,
      'Giàu, 0363467606 | , Long Bình - An Phú - An Giang (kế trạm xe khách hùng cường)',
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      provinceCode: target?.provinceCode,
      wardCode: target?.wardCode,
      newText: 'Xã Khánh Bình · Tỉnh An Giang',
    });
    expect(result.items[0]?.line.toLowerCase()).toContain('kế trạm xe khách hùng cường');
  });

  it('Phú Quốc: dương tơ + tỉnh mới An Giang (không nhãn xã, SĐT có chấm)', () => {
    const target = wardNamed('Tỉnh An Giang', 'Đặc Khu Phú Quốc');
    expect(target).toBeTruthy();
    for (const raw of [
      'Ga đến, sân bay QT Phú quốc, dương tơ-Phú Quốc - An Giang, Ms Hằng- 0944.887.829',
      'dương tơ, Phú Quốc, An Giang',
      'xã dương tơ, Phú Quốc, An Giang',
      'dương tơ, Phú Quốc, Kiên Giang',
    ]) {
      const result = searchLegacyAddress(rows, mapping, raw);
      expect(result.items.some((item) => item.wardCode === target?.wardCode), raw).toBe(true);
      expect(result.items[0]?.newText, raw).toMatch(/Phú Quốc.*An Giang/i);
    }
    const withStreet = searchLegacyAddress(
      rows,
      mapping,
      'Ga đến, sân bay QT Phú quốc, dương tơ-Phú Quốc - An Giang, Ms Hằng- 0944.887.829',
    );
    expect(withStreet.items[0]?.wardCode).toBe(target?.wardCode);
    // SĐT có chấm không được nhét vào số nhà.
    expect(`${withStreet.items[0]?.line || ''} ${withStreet.debug.tokens.join(' ')}`).not.toMatch(/0944/);
  });

  it('tin nhắn Bình Dương 3 cấp không dấu phẩy đổi sang Thủ Dầu Một, HCM', () => {
    const target = wardNamed('Thành phố Hồ Chí Minh', 'Phường Thủ Dầu Một');
    expect(target).toBeTruthy();
    const result = searchLegacyAddress(
      rows,
      mapping,
      '120/4 lý thường kiệt phường Phú cường thành phố thủ dầu một tỉnh bình dương',
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      provinceCode: target?.provinceCode,
      wardCode: target?.wardCode,
      line: '120/4 lý thường kiệt',
      newText: 'Phường Thủ Dầu Một · Thành phố Hồ Chí Minh',
    });
  });

  it('xã mới viết khác dấu gạch vẫn ra đúng mã', () => {
    const target = wardNamed('Tỉnh Lâm Đồng', 'Phường Cam Ly-Đà Lạt');
    expect(target).toBeTruthy();
    const result = searchLegacyAddress(rows, mapping, 'xa ta nung, thanh pho da lat, lam dong');
    expect(result.items[0]).toMatchObject({
      provinceCode: target?.provinceCode,
      wardCode: target?.wardCode,
      newText: 'Phường Cam Ly - Đà Lạt · Tỉnh Lâm Đồng',
    });
  });

  it('C2: ấp giữa câu viết liền + SĐT → Xã An Biên / An Giang, giữ số nhà', () => {
    const target = wardNamed('Tỉnh An Giang', 'Xã An Biên');
    expect(target).toBeTruthy();
    for (const raw of [
      'g ấp lo 3 hung yên an biên kien giang 0888405497',
      'ấp lộ 3 hưng yên an biên kiên giang',
      'hung yen an bien kien giang',
    ]) {
      const result = searchLegacyAddress(rows, mapping, raw);
      expect(result.items, raw).toHaveLength(1);
      expect(result.items[0], raw).toMatchObject({
        provinceCode: target?.provinceCode,
        wardCode: target?.wardCode,
        newText: 'Xã An Biên · Tỉnh An Giang',
      });
      expect(result.items[0]?.oldText.toLowerCase(), raw).toMatch(/hưng yên|hung yen/);
      expect(result.items[0]?.oldText.toLowerCase(), raw).toMatch(/an biên|an bien/);
    }
    const withStreet = searchLegacyAddress(
      rows,
      mapping,
      'g ấp lo 3 hung yên an biên kien giang 0888405497',
    );
    expect(withStreet.items[0]?.line.toLowerCase()).toMatch(/ấp|ap/);
    expect(withStreet.items[0]?.line.toLowerCase()).toMatch(/lo\s*3|3/);
  });

  it('C5: ngõ/hẻm/tổ tách khỏi xã–huyện–tỉnh có phẩy', () => {
    const target = wardNamed('Thành phố Hà Nội', 'Xã Mê Linh');
    expect(target).toBeTruthy();
    const result = searchLegacyAddress(
      rows,
      mapping,
      'ngõ 12, hẻm 3, tổ 5, Xã Tráng Việt, huyện Mê Linh, Hà Nội',
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      provinceCode: target?.provinceCode,
      wardCode: target?.wardCode,
      newText: 'Xã Mê Linh · Thành phố Hà Nội',
    });
    expect(result.items[0]?.line.toLowerCase()).toMatch(/ngõ|hem|hẻm|tổ|to/);
  });

  it('D6/D7: hưng yên vừa tỉnh vừa xã — phẩy huyện/tỉnh vẫn ra An Biên', () => {
    const target = wardNamed('Tỉnh An Giang', 'Xã An Biên');
    expect(target).toBeTruthy();
    for (const raw of ['hưng yên, an biên, kiên giang', 'an biên, hưng yên, kiên giang']) {
      const result = searchLegacyAddress(rows, mapping, raw);
      expect(result.items, raw).toHaveLength(1);
      expect(result.items[0], raw).toMatchObject({
        provinceCode: target?.provinceCode,
        wardCode: target?.wardCode,
        newText: 'Xã An Biên · Tỉnh An Giang',
      });
    }
  });

  it('số nhà đầu câu liền xã–huyện–tphcm (Bình Trị Đông) không nuốt hết thành street', () => {
    const target = wardNamed('Thành phố Hồ Chí Minh', 'Phường Bình Trị Đông');
    expect(target).toBeTruthy();
    const raw = '38/27a bình trị đông bình tân tphcm đt 0966254091';
    const result = searchLegacyAddress(rows, mapping, raw);
    expect(result.debug.tokens.join(' ')).toMatch(/binh tri dong/);
    expect(result.debug.tokens.join(' ')).toMatch(/ho chi minh/);
    expect(result.debug.reason).not.toBe('tokens-too-short');
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0]).toMatchObject({
      provinceCode: target?.provinceCode,
      wardCode: target?.wardCode,
      newText: 'Phường Bình Trị Đông · Thành phố Hồ Chí Minh',
    });
    expect(result.items[0]?.line.toLowerCase()).toContain('38/27a');
  });

  it('Đắk Lắk: tỉnh dính chữ + typo Chí thán → Đức Bình', () => {
    const target = wardNamed('Tỉnh Đắk Lắk', 'Xã Đức Bình');
    expect(target).toBeTruthy();
    const result = searchLegacyAddress(rows, mapping, 'Chí thán đức Bình đắklắk');
    expect(result.debug.tokens.join(' ')).toMatch(/dak lak/);
    expect(result.items.some((item) => item.wardCode === target?.wardCode)).toBe(true);
    expect(result.items.find((item) => item.wardCode === target?.wardCode)?.newText).toMatch(/Đức Bình.*Đắk Lắk/);
  });

  it('Đắk Lắk: bong bóng cắt «đắk lạ» vẫn ra Krông Ana, giữ số nhà', () => {
    const target = wardNamed('Tỉnh Đắk Lắk', 'Xã Krông Ana');
    expect(target).toBeTruthy();
    for (const raw of [
      '48 nguyễn tất thành xã krong ana tỉnh đắk lạ',
      'xã krông ana tỉnh đắk lắ',
      'krong ana đắk lạ',
    ]) {
      const result = searchLegacyAddress(rows, mapping, raw);
      expect(result.debug.tokens.join(' '), raw).toMatch(/dak lak/);
      expect(result.items.some((item) => item.wardCode === target?.wardCode), raw).toBe(true);
    }
    const withStreet = searchLegacyAddress(rows, mapping, '48 nguyễn tất thành xã krong ana tỉnh đắk lạ');
    expect(withStreet.items[0]?.line.toLowerCase()).toContain('48');
    expect(withStreet.items[0]?.line.toLowerCase()).toContain('nguyễn tất thành');
  });

  it('Đắk Lắk: pơngdrang/krôngbuk dính chữ + tổ dân phố giữ số nhà', () => {
    const target = wardNamed('Tỉnh Đắk Lắk', 'Xã Pơng Drang');
    expect(target).toBeTruthy();
    const result = searchLegacyAddress(
      rows,
      mapping,
      'Tổ dân phố 1 , pơngdrang , krôngbuk , đăk lăk',
    );
    expect(result.debug.tokens.join(' ')).toBe('pong drang krong buk dak lak');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      provinceCode: target?.provinceCode,
      wardCode: target?.wardCode,
      newText: 'Xã Pơng Drang · Tỉnh Đắk Lắk',
      line: 'Tổ dân phố 1',
    });
  });

  it('Đồng Nai: thiếu huyện + typo tình→tỉnh vẫn map Thiện Tân → Trảng Dài', () => {
    const target = wardNamed('Tỉnh Đồng Nai', 'Phường Trảng Dài');
    expect(target).toBeTruthy();
    for (const raw of [
      'Công ty Dũng Khanh cụm công nghiệp xã thiên tân tình đồng nai',
      'Công ty Dũng Khanh cụm công nghiệp xã thiên tân tinh đồng nai',
      'xã thiện tân tỉnh đồng nai',
    ]) {
      const result = searchLegacyAddress(rows, mapping, raw);
      expect(result.items[0], raw).toMatchObject({
        provinceCode: target?.provinceCode,
        wardCode: target?.wardCode,
        newText: 'Phường Trảng Dài · Tỉnh Đồng Nai',
      });
      expect(result.items[0]?.oldText.toLowerCase(), raw).toContain('thiện tân');
    }
    const withStreet = searchLegacyAddress(
      rows,
      mapping,
      'Công ty Dũng Khanh cụm công nghiệp xã thiên tân tình đồng nai',
    );
    expect(withStreet.items[0]?.line.toLowerCase()).toContain('dũng khanh');
  });

  it('HCM: 923A Âu Cơ .P.Tân Sơn Nhì.Q.Tân Phú + SĐT → Phường Tân Sơn Nhì', () => {
    const target = wardNamed('Thành phố Hồ Chí Minh', 'Phường Tân Sơn Nhì');
    expect(target).toBeTruthy();
    const raw = '923A. ÂU CƠ .P.Tân sơn nhì.Q.tân phú..\n0934130461';
    const result = searchLegacyAddress(rows, mapping, raw);
    expect(result.debug.tokens.join(' ')).toMatch(/tan son nhi/);
    expect(result.debug.tokens.join(' ')).toMatch(/tan phu/);
    expect(result.items[0]).toMatchObject({
      provinceCode: target?.provinceCode,
      wardCode: target?.wardCode,
      newText: 'Phường Tân Sơn Nhì · Thành phố Hồ Chí Minh',
    });
    expect(result.items[0]?.line.toLowerCase()).toContain('923a');
    expect(result.items[0]?.line.toLowerCase()).toMatch(/âu cơ|au co/);
  });

  it('Đắk Lắk: typo thiếu/sai 1 ký tự trên xã–huyện vẫn ra Pơng Drang', () => {
    const target = wardNamed('Tỉnh Đắk Lắk', 'Xã Pơng Drang');
    expect(target).toBeTruthy();
    for (const raw of [
      'Tổ dân phố 1, pơngdran, krongbuk, đăk lăk',
      'pong dran, krong buk, dak lak',
      'pongdran, krongbu, daklak',
      'Pơng Drang, Krông Búk, Đắk Lắk',
    ]) {
      const result = searchLegacyAddress(rows, mapping, raw);
      expect(result.items.some((item) => item.wardCode === target?.wardCode), raw).toBe(true);
      expect(result.items[0]?.provinceCode, raw).toBe(target?.provinceCode);
    }
    const withStreet = searchLegacyAddress(rows, mapping, 'Tổ dân phố 1, pơngdran, krongbuk, đăk lăk');
    expect(withStreet.items[0]?.line.toLowerCase()).toContain('tổ dân phố 1');
  });

  it('typo soft: exact vẫn thắng soft; token ngắn không đoán bừa', () => {
    const exact = searchLegacyAddress(rows, mapping, 'trang viet');
    expect(exact.items).toHaveLength(1);
    expect(exact.items[0]?.newText).toMatch(/Mê Linh/);

    const shortNoise = searchLegacyAddress(rows, mapping, 'an');
    expect(shortNoise.debug.reason === 'tokens-too-short' || shortNoise.items.length === 0).toBe(true);

    const longThanh = searchLegacyAddress(rows, mapping, 'long thanh');
    expect(longThanh.items.some((item) => /long thành/i.test(item.newText))).toBe(true);
    // «long» đơn lẻ quá ngắn để soft-match thành tên xã dài.
    const onlyLong = searchLegacyAddress(rows, mapping, 'long');
    expect(onlyLong.items.every((item) => !/pơng drang/i.test(item.newText))).toBe(true);
  });

  it('alias tỉnh cũ / dính chữ: kiengiang→An Giang, binhduong→HCM, nhatrang', () => {
    const phuQuoc = wardNamed('Tỉnh An Giang', 'Đặc Khu Phú Quốc');
    expect(phuQuoc).toBeTruthy();
    for (const raw of ['duong to, phuquoc, kiengiang', 'duong to, phuquoc, angiang']) {
      const pq = searchLegacyAddress(rows, mapping, raw);
      expect(pq.items.some((item) => item.wardCode === phuQuoc?.wardCode), raw).toBe(true);
    }

    const nt = searchLegacyAddress(rows, mapping, 'nhatrang, khanhhoa');
    expect(nt.items.some((item) => /nha trang|khanh hoa|khánh hòa/i.test(`${item.newText} ${item.oldText}`))).toBe(
      true,
    );

    const bd = searchLegacyAddress(rows, mapping, 'thudautmot, binhduong');
    expect(bd.items.length).toBeGreaterThan(0);
    expect(bd.items.some((item) => /hồ chí minh|ho chi minh|thủ dầu một|thu dau mot/i.test(item.newText))).toBe(
      true,
    );
  });

  it('Lâm Đồng: langbiang / dalat dính chữ → Phường Lang Biang-Đà Lạt', () => {
    const target = wardNamed('Tỉnh Lâm Đồng', 'Phường Lang Biang-Đà Lạt');
    expect(target).toBeTruthy();
    for (const raw of [
      '374 xo viet nghe tinh,phuong langbiang,tp dalat',
      'phuong langbiang, tp dalat',
      'langbiang, dalat',
      'langbiang dalat',
      'phường langbiang, đà lạt',
    ]) {
      const result = searchLegacyAddress(rows, mapping, raw);
      expect(result.items[0], raw).toMatchObject({
        provinceCode: target?.provinceCode,
        wardCode: target?.wardCode,
      });
      expect(result.items[0]?.newText, raw).toMatch(/Lang Biang.*Đà Lạt.*Lâm Đồng/);
    }
    const street = searchLegacyAddress(
      rows,
      mapping,
      '374 xo viet nghe tinh,phuong langbiang,tp dalat',
    );
    expect(street.items[0]?.line.toLowerCase()).toContain('374');
  });

  it('Đắk Lắk: chí thạnh / đức bình đông regression', () => {
    const tuyAnBac = wardNamed('Tỉnh Đắk Lắk', 'Xã Tuy An Bắc');
    const ducBinh = wardNamed('Tỉnh Đắk Lắk', 'Xã Đức Bình');
    expect(tuyAnBac).toBeTruthy();
    expect(ducBinh).toBeTruthy();

    const chiThanh = searchLegacyAddress(rows, mapping, 'chí thạnh tuy an');
    expect(chiThanh.items[0]).toMatchObject({
      provinceCode: tuyAnBac?.provinceCode,
      wardCode: tuyAnBac?.wardCode,
    });

    const chiThan = searchLegacyAddress(rows, mapping, 'chí thán');
    expect(chiThan.items.some((item) => item.wardCode === tuyAnBac?.wardCode)).toBe(true);

    const ducBinhDong = searchLegacyAddress(rows, mapping, 'đức bình đông');
    expect(ducBinhDong.items[0]).toMatchObject({
      provinceCode: ducBinh?.provinceCode,
      wardCode: ducBinh?.wardCode,
      newText: 'Xã Đức Bình · Tỉnh Đắk Lắk',
    });
  });
});
