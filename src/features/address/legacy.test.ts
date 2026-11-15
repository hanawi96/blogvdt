import { describe, expect, it } from 'vitest';
import rowsText from '../../../public/data/address-select.json?raw';
import mappingText from '../../../public/data/ward_mapping_2025.json?raw';
import { foldAddressText, type AddressSelectRow } from './parse';
import { legacyCoverage, searchLegacyAddress } from './legacy';

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
