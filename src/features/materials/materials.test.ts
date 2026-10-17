import { describe, expect, it } from 'vitest';
import {
  MATERIAL_MAX_PRICE,
  deriveMaterialCode,
  materialChangeSummary,
  materialInUseError,
  parseMaterialInput,
  parseMaterialPrice,
} from './materials';

const base = { name: 'Charm chuông', code: '', groupId: 1, unitCost: '35000', active: true };

describe('đơn giá nguyên liệu', () => {
  it('nhận số nguyên VND, bỏ dấu phân cách hàng nghìn', () => {
    expect(parseMaterialPrice('35000')).toBe(35000);
    expect(parseMaterialPrice('35.000')).toBe(35000);
    expect(parseMaterialPrice('35,000')).toBe(35000);
    expect(parseMaterialPrice(' 1 200 ')).toBe(1200);
    expect(parseMaterialPrice('0')).toBe(0);
  });

  it('từ chối rỗng, chữ, số âm, số lẻ và vượt trần', () => {
    expect(parseMaterialPrice('')).toBeNull();
    expect(parseMaterialPrice('abc')).toBeNull();
    expect(parseMaterialPrice('-5')).toBeNull();
    expect(parseMaterialPrice('12.5a')).toBeNull();
    expect(parseMaterialPrice(String(MATERIAL_MAX_PRICE + 1))).toBeNull();
    expect(parseMaterialPrice(String(MATERIAL_MAX_PRICE))).toBe(MATERIAL_MAX_PRICE);
  });
});

describe('mã nguyên liệu', () => {
  it('sinh mã snake_case không dấu từ tên', () => {
    expect(deriveMaterialCode('Charm chuông')).toBe('charm_chuong');
    expect(deriveMaterialCode('Hổ phách vàng')).toBe('ho_phach_vang');
    expect(deriveMaterialCode('Bi bạc 4ly S999')).toBe('bi_bac_4ly_s999');
    expect(deriveMaterialCode('!!!')).toBe('');
  });
});

describe('kiểm tra form nguyên liệu', () => {
  it('chuẩn hóa dữ liệu hợp lệ', () => {
    const parsed = parseMaterialInput({ ...base, name: '  Charm   chuông ', unitCost: '35.000', code: ' Charm_Chuong ' });
    expect(parsed).toEqual({
      ok: true,
      value: { name: 'Charm chuông', code: 'charm_chuong', groupId: 1, unitCost: 35000, active: true },
    });
  });

  it('khi sửa thì bỏ qua mã gửi lên', () => {
    expect(parseMaterialInput({ ...base, code: 'Mã Sai!' }, false).ok).toBe(true);
    expect(parseMaterialInput({ ...base, code: 'Mã Sai!' }, true).ok).toBe(false);
  });

  it('báo lỗi thiếu tên, thiếu nhóm, giá sai, mã sai', () => {
    expect(parseMaterialInput({ ...base, name: '  ' })).toEqual({ ok: false, error: 'Nhập tên nguyên liệu.' });
    expect(parseMaterialInput({ ...base, groupId: 0 })).toEqual({ ok: false, error: 'Chọn nhóm nguyên liệu.' });
    expect(parseMaterialInput({ ...base, unitCost: 'abc' }).ok).toBe(false);
    expect(parseMaterialInput({ ...base, code: 'Mã Sai!' }).ok).toBe(false);
    expect(parseMaterialInput({ ...base, name: 'a'.repeat(121) }).ok).toBe(false);
  });
});

describe('nhật ký và chặn xóa', () => {
  it('ghi rõ giá cũ và giá mới khi đổi giá', () => {
    const up = materialChangeSummary('Charm rắn', { unitCost: 100000, active: true }, { unitCost: 110000, active: true });
    expect(up).toContain('Charm rắn');
    expect(up).toContain('lên');
    const down = materialChangeSummary('Charm rắn', { unitCost: 100000, active: true }, { unitCost: 90000, active: true });
    expect(down).toContain('xuống');
  });

  it('phân biệt tạo mới, ngừng dùng và sửa thông tin khác', () => {
    expect(materialChangeSummary('Đá đỏ', null, { unitCost: 10000, active: true })).toContain('Đã tạo');
    expect(materialChangeSummary('Đá đỏ', { unitCost: 10000, active: true }, { unitCost: 10000, active: false })).toContain('Ngừng dùng');
    expect(materialChangeSummary('Đá đỏ', { unitCost: 10000, active: false }, { unitCost: 10000, active: true })).toContain('Dùng lại');
    expect(materialChangeSummary('Đá đỏ', { unitCost: 10000, active: true }, { unitCost: 10000, active: true })).toContain('Đã cập nhật');
  });

  it('chỉ chặn xóa khi còn sản phẩm dùng', () => {
    expect(materialInUseError(0)).toBeNull();
    expect(materialInUseError(13)).toContain('13 sản phẩm');
  });
});
