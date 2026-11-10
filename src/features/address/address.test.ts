import { describe, expect, it } from 'vitest';
import treeText from '../../../public/data/tree_2.json?raw';
import flatText from '../../../public/data/dia_chi_2_cap.json?raw';
import slimText from '../../../public/data/address-select.json?raw';
import { matchComposedAddress, type AddressSelectRow } from './parse';

type TreeWard = { code: string; fullName: string };
type TreeProvince = { code: string; fullName: string; wards: TreeWard[] };
type FlatWard = { name_with_type: string; parent_code: string };

const tree = JSON.parse(treeText) as TreeProvince[];
const flat = JSON.parse(flatText) as Record<string, FlatWard>;
const slim = JSON.parse(slimText) as AddressSelectRow[];

describe('danh sách địa chỉ chọn trên form', () => {
  it('khớp đủ tỉnh và phường xã của cả hai file gốc', () => {
    expect(slim).toHaveLength(tree.length);
    let wards = 0;
    tree.forEach((province, index) => {
      const row = slim[index];
      expect(row?.[0]).toBe(province.code);
      expect(row?.[1]).toBe(province.fullName);
      expect(row?.[2]).toHaveLength(province.wards.length);
      province.wards.forEach((ward, wardIndex) => {
        const label = ward.fullName.slice(0, -(province.fullName.length + 2));
        const listed = row?.[2][wardIndex];
        const source = flat[ward.code];
        expect(listed).toEqual([ward.code, label]);
        expect(source?.name_with_type).toBe(label);
        expect(source?.parent_code).toBe(province.code);
        wards += 1;
      });
    });
    expect(wards).toBe(Object.keys(flat).length);
  });

  it('tách lại địa chỉ đã ghép khi mở form sửa đơn', () => {
    const province = slim[0];
    const ward = province?.[2][0];
    expect(province && ward).toBeTruthy();
    if (!province || !ward) return;
    const composed = `12 đường Mẫu, hẻm 3, ${ward[1]}, ${province[1]}`;
    expect(matchComposedAddress(slim, composed)).toEqual({
      provinceCode: province[0],
      wardCode: ward[0],
      line: '12 đường Mẫu, hẻm 3',
    });
    expect(matchComposedAddress(slim, 'địa chỉ cũ không chuẩn')).toBeNull();
  });
});