import { describe, expect, it } from 'vitest';
import treeText from '../../../public/data/tree_2.json?raw';
import flatText from '../../../public/data/dia_chi_2_cap.json?raw';
import slimText from '../../../public/data/address-select.json?raw';
import { matchComposedAddress, parseChatAddress, parseQuickRecipient, provinceCodeFromAddress, type AddressSelectRow } from './parse';

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

  it('lấy mã tỉnh từ địa chỉ ghép hoặc chỉ đuôi tên tỉnh', () => {
    const province = slim[0];
    const ward = province?.[2][0];
    expect(province && ward).toBeTruthy();
    if (!province || !ward) return;
    expect(provinceCodeFromAddress(slim, `12 đường Mẫu, ${ward[1]}, ${province[1]}`)).toBe(province[0]);
    expect(provinceCodeFromAddress(slim, `nhà 1, ${province[1]}`)).toBe(province[0]);
    expect(provinceCodeFromAddress(slim, 'địa chỉ cũ không chuẩn')).toBeNull();
  });

  it('nhận diện địa chỉ từ tin chat kiểu ship về', () => {
    const caMau = slim.find((row) => row[1] === 'Tỉnh Cà Mau');
    const namCan = caMau?.[2].find((ward) => ward[1] === 'Xã Năm Căn');
    expect(caMau && namCan).toBeTruthy();
    if (!caMau || !namCan) return;

    const parsed = parseChatAddress(slim, 'Ship về địa chỉ 26 Hùng Vương, xã Năm Căn, Cà Mau');
    expect(parsed).toEqual({
      provinceCode: caMau[0],
      wardCode: namCan[0],
      line: '26 Hùng Vương',
      confidence: 'high',
    });
  });

  it('tin chat chỉ có tỉnh vẫn trả medium', () => {
    const caMau = slim.find((row) => row[1] === 'Tỉnh Cà Mau');
    expect(caMau).toBeTruthy();
    if (!caMau) return;
    const parsed = parseChatAddress(slim, 'Gửi về 26 Hùng Vương, Cà Mau');
    expect(parsed?.provinceCode).toBe(caMau[0]);
    expect(parsed?.wardCode).toBeNull();
    expect(parsed?.line).toBe('26 Hùng Vương');
    expect(parsed?.confidence).toBe('medium');
  });

  it('nhận diện viết tắt TPHCM + P. và số nhà có slash', () => {
    const hcm = slim.find((row) => row[1] === 'Thành phố Hồ Chí Minh');
    const ducNhuan = hcm?.[2].find((ward) => ward[1] === 'Phường Đức Nhuận');
    expect(hcm && ducNhuan).toBeTruthy();
    if (!hcm || !ducNhuan) return;

    const parsed = parseChatAddress(slim, '469/24F Nguyễn Kiệm, P Đức Nhuận, TPHCM');
    expect(parsed).toMatchObject({
      provinceCode: hcm[0],
      wardCode: ducNhuan[0],
      line: '469/24F Nguyễn Kiệm',
      confidence: 'high',
    });
  });

  it('nhận diện P. Phú Nhuận + TP HCM', () => {
    const hcm = slim.find((row) => row[1] === 'Thành phố Hồ Chí Minh');
    const phuNhuan = hcm?.[2].find((ward) => ward[1] === 'Phường Phú Nhuận');
    expect(hcm && phuNhuan).toBeTruthy();
    if (!hcm || !phuNhuan) return;

    const parsed = parseChatAddress(slim, '12 Nguyễn Văn Trỗi, P. Phú Nhuận, TP HCM');
    expect(parsed).toMatchObject({
      provinceCode: hcm[0],
      wardCode: phuNhuan[0],
      line: '12 Nguyễn Văn Trỗi',
      confidence: 'high',
    });
  });

  it('nhận diện phường Xuân Hoà + TPHCM', () => {
    const hcm = slim.find((row) => row[1] === 'Thành phố Hồ Chí Minh');
    const xuanHoa = hcm?.[2].find((ward) => ward[1] === 'Phường Xuân Hòa');
    expect(hcm && xuanHoa).toBeTruthy();
    if (!hcm || !xuanHoa) return;

    const parsed = parseChatAddress(slim, '51 Ngô Thời Nhiệm, phường Xuân Hoà, TPHCM');
    expect(parsed).toMatchObject({
      provinceCode: hcm[0],
      wardCode: xuanHoa[0],
      line: '51 Ngô Thời Nhiệm',
      confidence: 'high',
    });
  });

  it('tách SĐT khỏi địa chỉ chat', () => {
    const hcm = slim.find((row) => row[1] === 'Thành phố Hồ Chí Minh');
    const ducNhuan = hcm?.[2].find((ward) => ward[1] === 'Phường Đức Nhuận');
    expect(hcm && ducNhuan).toBeTruthy();
    if (!hcm || !ducNhuan) return;

    const parsed = parseChatAddress(slim, '469/24F Nguyễn Kiệm, P Đức Nhuận, TPHCM 0902939419');
    expect(parsed).toMatchObject({
      provinceCode: hcm[0],
      wardCode: ducNhuan[0],
      line: '469/24F Nguyễn Kiệm',
      confidence: 'high',
      phones: ['0902939419'],
    });
  });

  it('dán nhanh: tách SĐT có dấu chấm và bỏ dòng họ tên', () => {
    const hcm = slim.find((row) => row[1] === 'Thành phố Hồ Chí Minh');
    const ducNhuan = hcm?.[2].find((ward) => ward[1] === 'Phường Đức Nhuận');
    expect(hcm && ducNhuan).toBeTruthy();
    if (!hcm || !ducNhuan) return;

    const parsed = parseQuickRecipient(
      slim,
      'Nguyễn Thị Lan\n0902.939.419\n469/24F Nguyễn Kiệm, P Đức Nhuận, TPHCM',
    );
    expect(parsed.phone).toBe('0902939419');
    expect(parsed.name).toBe('Nguyễn Thị Lan');
    expect(parsed.match).toMatchObject({
      provinceCode: hcm[0],
      wardCode: ducNhuan[0],
      line: '469/24F Nguyễn Kiệm',
      confidence: 'high',
    });
  });

  it('bỏ quận cũ và lấy phường ghi rõ phía trước', () => {
    const hcm = slim.find((row) => row[1] === 'Thành phố Hồ Chí Minh');
    const ducNhuan = hcm?.[2].find((ward) => ward[1] === 'Phường Đức Nhuận');
    expect(hcm && ducNhuan).toBeTruthy();
    if (!hcm || !ducNhuan) return;

    const parsed = parseChatAddress(slim, '12 Nguyễn Huệ, Phường Đức Nhuận, Quận 3, TPHCM');
    expect(parsed).toMatchObject({
      provinceCode: hcm[0],
      wardCode: ducNhuan[0],
      line: '12 Nguyễn Huệ',
      confidence: 'high',
    });
  });

  it('nhận phường ở giữa câu khi cuối không phải tên xã', () => {
    const hcm = slim.find((row) => row[1] === 'Thành phố Hồ Chí Minh');
    const xuanHoa = hcm?.[2].find((ward) => ward[1] === 'Phường Xuân Hòa');
    expect(hcm && xuanHoa).toBeTruthy();
    if (!hcm || !xuanHoa) return;

    const parsed = parseChatAddress(slim, '51 Ngô Thời Nhiệm phường Xuân Hoà gần chợ TPHCM');
    expect(parsed).toMatchObject({
      provinceCode: hcm[0],
      wardCode: xuanHoa[0],
      confidence: 'high',
    });
    expect(parsed?.line.startsWith('51 Ngô Thời Nhiệm')).toBe(true);
    expect(parsed?.line.toLowerCase()).not.toContain('xuân');
  });

  it('mã tỉnh cuối câu và viết tắt quận cũ', () => {
    const caMau = slim.find((row) => row[1] === 'Tỉnh Cà Mau');
    const namCan = caMau?.[2].find((ward) => ward[1] === 'Xã Năm Căn');
    const hcm = slim.find((row) => row[1] === 'Thành phố Hồ Chí Minh');
    const phuNhuan = hcm?.[2].find((ward) => ward[1] === 'Phường Phú Nhuận');
    expect(caMau && namCan && hcm && phuNhuan).toBeTruthy();
    if (!caMau || !namCan || !hcm || !phuNhuan) return;

    expect(parseChatAddress(slim, '26 Hùng Vương, xã Năm Căn, cm')).toMatchObject({
      provinceCode: caMau[0],
      wardCode: namCan[0],
      line: '26 Hùng Vương',
      confidence: 'high',
    });
    expect(parseChatAddress(slim, '12 Lê Lợi, p/nhuan, hcm')).toMatchObject({
      provinceCode: hcm[0],
      wardCode: phuNhuan[0],
      line: '12 Lê Lợi',
      confidence: 'high',
    });
  });

  it('nhận tên phường nằm giữa câu dù không có chữ phường', () => {
    const hcm = slim.find((row) => row[1] === 'Thành phố Hồ Chí Minh');
    const xuanHoa = hcm?.[2].find((ward) => ward[1] === 'Phường Xuân Hòa');
    expect(hcm && xuanHoa).toBeTruthy();
    if (!hcm || !xuanHoa) return;

    const parsed = parseChatAddress(slim, '51 Ngô Thời Nhiệm Xuân Hoà gần chợ TPHCM');
    expect(parsed).toMatchObject({
      provinceCode: hcm[0],
      wardCode: xuanHoa[0],
      confidence: 'high',
    });
    expect(parsed?.line.startsWith('51 Ngô Thời Nhiệm')).toBe(true);
  });

  it('tin nhắn chat bỏ nhãn và emoticon trước khi tách', () => {
    const hcm = slim.find((row) => row[1] === 'Thành phố Hồ Chí Minh');
    const phuNhuan = hcm?.[2].find((ward) => ward[1] === 'Phường Phú Nhuận');
    expect(hcm && phuNhuan).toBeTruthy();
    if (!hcm || !phuNhuan) return;

    const parsed = parseQuickRecipient(slim, 'Tên: Nguyễn Thị Lan\nSĐT: 0902.939.419 /heart\nĐịa chỉ: 12 Lê Lợi, p/nhuan, hcm');
    expect(parsed.phone).toBe('0902939419');
    expect(parsed.name).toBe('Nguyễn Thị Lan');
    expect(parsed.match).toMatchObject({
      provinceCode: hcm[0],
      wardCode: phuNhuan[0],
      line: '12 Lê Lợi',
      confidence: 'high',
    });
  });

  it('nhận số di động thiếu số 0', () => {
    const parsed = parseQuickRecipient(slim, '984923405\n12 Lê Lợi, p/nhuan, hcm');
    expect(parsed.phone).toBe('0984923405');
    expect(parsed.match?.confidence).toBe('high');
  });
});