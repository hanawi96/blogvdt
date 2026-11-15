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
    const result = searchLegacyAddress(rows, mapping, 'trang viet');
    expect(result.more).toBe(false);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      provinceCode: target?.provinceCode,
      wardCode: target?.wardCode,
      line: '',
      newText: 'Xã Mê Linh · Thành phố Hà Nội',
    });
    expect(result.items[0]?.oldText.toLowerCase()).toContain('tráng việt');
    expect(result.items[0]?.oldText.toLowerCase()).toContain('mê linh');
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

  it('tên xã trùng nhiều nơi thì trả nhiều dòng, không gộp thành một', () => {
    const result = searchLegacyAddress(rows, mapping, 'tan thanh');
    expect(result.items.length).toBeGreaterThan(1);
    expect(result.more).toBe(true);
    for (const item of result.items) {
      expect(foldAddressText(`${item.oldText} ${item.newText}`)).toContain('tan thanh');
    }
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
});
