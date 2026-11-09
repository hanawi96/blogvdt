import { describe, expect, it } from 'vitest';
import type { WeightScale } from '../products/weight';
import { applyStaffCollection, capDiscount, orderLineSources, parseStaffCustomer, priceStaffLines, readStaffFlags, settleStaffTotal, staffExtraRoundPresets, staffOrderColumns, staffShipDayAfter, type StoredOrderLine } from './staff';

const catalog: { id: number; name: string; price: number; weightScale: WeightScale }[] = [
  { id: 1, name: 'Vòng tơ tằm trơn', price: 150000, weightScale: 'none' },
  { id: 7, name: 'Vòng cho bé', price: 120000, weightScale: 'baby' },
];

const stored: StoredOrderLine[] = [
  { productId: 7, productName: 'Vòng cho bé', unitPrice: 100000, quantity: 1, optionLabel: '5kg', lineTotal: 100000 },
  { productId: 7, productName: 'Vòng cho bé', unitPrice: 110000, quantity: 1, optionLabel: '5kg', lineTotal: 110000 },
  { productId: null, productName: 'Mẫu đã xóa', unitPrice: 90000, quantity: 1, optionLabel: '3kg', lineTotal: 90000 },
];

function line(slot: string, productId: string, weight: string, quantity = '1') {
  return { slot, productId, weight, quantity };
}

describe('đơn nhân viên nhập', () => {
  it('dòng mới lấy giá đang bán và bắt cân nặng đúng thang', () => {
    const priced = priceStaffLines([line('', '7', '4kg', '2')], catalog, []);
    expect(priced.ok && priced.lines[0]).toMatchObject({ unitPrice: 120000, quantity: 2, lineTotal: 240000, optionLabel: '4kg' });
    expect(priceStaffLines([line('', '7', '')], catalog, []).ok).toBe(false);
    expect(priceStaffLines([line('', '1', '5kg')], catalog, []).ok).toBe(false);
    expect(priceStaffLines([line('', '1', '')], catalog, []).ok).toBe(true);
  });

  it('chỉ đổi số lượng thì giữ đơn giá cũ, đổi cân hoặc mẫu thì lấy giá mới', () => {
    const kept = priceStaffLines([line('0', '7', '5kg', '3')], catalog, stored);
    expect(kept.ok && kept.lines[0]).toMatchObject({ unitPrice: 100000, lineTotal: 300000 });
    const weight = priceStaffLines([line('0', '7', '6kg')], catalog, stored);
    expect(weight.ok && weight.lines[0]?.unitPrice).toBe(120000);
    const product = priceStaffLines([line('0', '1', '')], catalog, stored);
    expect(product.ok && product.lines[0]).toMatchObject({ productId: 1, unitPrice: 150000, optionLabel: null });
  });

  it('mỗi dòng cũ giữ đúng giá của mình, dòng thêm cùng mẫu lấy giá đang bán', () => {
    const priced = priceStaffLines([line('0', '7', '5kg'), line('1', '7', '5kg'), line('', '7', '5kg')], catalog, stored);
    expect(priced.ok && priced.lines.map((item) => item.unitPrice)).toEqual([100000, 110000, 120000]);
    const reused = priceStaffLines([line('0', '7', '5kg'), line('0', '7', '5kg')], catalog, stored);
    expect(reused.ok && reused.lines.map((item) => item.unitPrice)).toEqual([100000, 120000]);
  });

  it('mẫu đã xóa giữ nguyên khi không đổi, và phải chọn mẫu khác khi đổi cân', () => {
    const kept = priceStaffLines([line('2', '', '3kg', '2')], catalog, stored);
    expect(kept.ok && kept.lines[0]).toMatchObject({ productId: null, productName: 'Mẫu đã xóa', unitPrice: 90000, lineTotal: 180000 });
    const changed = priceStaffLines([line('2', '', '4kg')], catalog, stored);
    expect(changed.ok).toBe(false);
  });

  it('đơn giá gõ tay thay giá đang bán, kể cả khi đổi cân', () => {
    const agreed = priceStaffLines([{ ...line('', '1', ''), price: '45.000' }], catalog, []);
    expect(agreed.ok && agreed.lines[0]).toMatchObject({ unitPrice: 45000, lineTotal: 45000 });
    const heavier = priceStaffLines([{ ...line('', '7', '15kg'), price: '180000' }], catalog, []);
    expect(heavier.ok && heavier.lines[0]).toMatchObject({ unitPrice: 180000, optionLabel: '15kg' });
    const kept = priceStaffLines([{ ...line('0', '7', '5kg'), price: '90000' }], catalog, stored);
    expect(kept.ok && kept.lines[0]?.unitPrice).toBe(90000);
    expect(priceStaffLines([{ ...line('', '1', ''), price: 'abc' }], catalog, []).ok).toBe(false);
    const renamed = priceStaffLines([{ ...line('0', '7', '5kg', '3'), name: '  Vòng mix bạc  ' }], catalog, stored);
    expect(renamed.ok && renamed.lines[0]).toMatchObject({ productId: 7, productName: 'Vòng mix bạc', unitPrice: 100000, lineTotal: 300000 });
    const fresh = priceStaffLines([{ ...line('', '7', '4kg'), name: 'Tên riêng' }], catalog, []);
    expect(fresh.ok && fresh.lines[0]).toMatchObject({ productId: 7, productName: 'Tên riêng', unitPrice: 120000 });
    expect(priceStaffLines([{ ...line('', '1', ''), name: '   ' }], catalog, []).ok).toBe(false);
  });

  it('từ chối đơn trống, quá số mẫu và số lượng lạ', () => {
    expect(priceStaffLines([], catalog, []).ok).toBe(false);
    expect(priceStaffLines(Array.from({ length: 9 }, () => line('', '1', '')), catalog, []).ok).toBe(false);
    expect(priceStaffLines([line('', '1', '', '0')], catalog, []).ok).toBe(false);
  });

  it('gửi bù không thu tiền, phí ship cộng sau giảm và miễn phí thì khách trả 0', () => {
    expect(applyStaffCollection(45_000, 5_000, 'SALE', { compensation: true, shippingFee: 16_000 })).toEqual({
      ok: true, totalPrice: 0, discountAmount: 0, discountCode: null, shippingFee: 0,
    });
    expect(applyStaffCollection(45_000, 0, null, { compensation: false, shippingFee: 16_000 })).toMatchObject({ ok: true, totalPrice: 61_000, shippingFee: 16_000 });
    const free = readStaffFlags({ payState: 'cod', source: 'zalo', priority: '', compensation: '', shipLater: 'on', shipOn: '2026-10-25', shippingFee: '16.000', freeShip: 'on' });
    expect(free.ok && free.flags).toMatchObject({ source: 'zalo', payState: 'cod', paymentMethod: 'cod', priority: false, shippingFee: 0, shipOn: Date.parse('2026-10-25T00:00:00+07:00') });
    expect(readStaffFlags({ payState: 'cod', source: 'zalo', priority: 'on', compensation: '', shipLater: 'on', shipOn: '2026-10-25', shippingFee: '', freeShip: '' }).ok).toBe(false);
    expect(readStaffFlags({ payState: 'paid', source: '', priority: '', compensation: '', shipLater: '', shipOn: '', shippingFee: '', freeShip: '' }).ok).toBe(false);
    expect(readStaffFlags({ payState: 'deposit', source: 'tiktok', priority: '', compensation: '', shipLater: 'on', shipOn: '', shippingFee: '', freeShip: '' }).ok).toBe(false);
  });

  it('tổng gõ tay là số khách phải trả, không vượt tạm tính', () => {
    expect(settleStaffTotal(50_000, 0, '45.000')).toEqual({ ok: true, totalPrice: 45_000, discountAmount: 5_000 });
    expect(settleStaffTotal(50_000, 10_000, '')).toEqual({ ok: true, totalPrice: 40_000, discountAmount: 10_000 });
    expect(settleStaffTotal(50_000, 10_000, '', '5.000')).toEqual({ ok: true, totalPrice: 35_000, discountAmount: 15_000 });
    expect(settleStaffTotal(50_000, 10_000, '', '100.000')).toEqual({ ok: true, totalPrice: 0, discountAmount: 50_000 });
    expect(settleStaffTotal(50_000, 10_000, '30.000')).toEqual({ ok: true, totalPrice: 30_000, discountAmount: 20_000 });
    expect(settleStaffTotal(50_000, 0, '50000')).toEqual({ ok: true, totalPrice: 50_000, discountAmount: 0 });
    expect(settleStaffTotal(50_000, 0, '60000').ok).toBe(false);
    expect(settleStaffTotal(50_000, 10_000, '45.000').ok).toBe(false);
    expect(settleStaffTotal(50_000, 0, 'abc').ok).toBe(false);
    expect(settleStaffTotal(50_000, 0, '', 'abc').ok).toBe(false);
  });

  it('preset giảm thêm làm tròn tổng về mốc 10.000', () => {
    expect(staffExtraRoundPresets(298_000)).toEqual([8_000, 18_000, 28_000]);
    expect(staffExtraRoundPresets(200_000)).toEqual([10_000, 20_000, 30_000]);
    expect(staffExtraRoundPresets(305_000)).toEqual([5_000, 15_000, 25_000]);
    expect(staffExtraRoundPresets(8_000)).toEqual([]);
  });

  it('preset gửi sau cộng đúng số ngày theo lịch VN', () => {
    const noon = Date.parse('2026-11-09T12:00:00+07:00');
    expect(staffShipDayAfter(10, noon)).toBe('2026-11-19');
    expect(staffShipDayAfter(30, noon)).toBe('2026-12-09');
    expect(staffShipDayAfter(60, Date.parse('2026-01-15T08:00:00+07:00'))).toBe('2026-03-16');
  });

  it('giảm giá không vượt tạm tính mới, một mẫu và nhiều mẫu lưu khác nhau', () => {
    expect(capDiscount(8000, 10000)).toEqual({ discountAmount: 8000, totalPrice: 0 });
    expect(capDiscount(200000, 10000)).toEqual({ discountAmount: 10000, totalPrice: 190000 });
    const one = priceStaffLines([line('', '1', '', '2')], catalog, []);
    if (!one.ok) throw new Error('line');
    expect(staffOrderColumns(one.lines)).toMatchObject({ productId: 1, quantity: 2, unitPrice: 150000, subtotal: 300000 });
    const two = priceStaffLines([line('', '1', ''), line('', '7', '3kg')], catalog, []);
    if (!two.ok) throw new Error('lines');
    expect(staffOrderColumns(two.lines)).toMatchObject({ productId: null, unitPrice: 0, quantity: 2, optionLabel: null, subtotal: 270000 });
  });

  it('khách của đơn nhập tay dùng cùng quy tắc với đơn trên website', () => {
    const bad = parseStaffCustomer({ customerName: '', phone: '123', address: 'ngắn', note: '', paymentMethod: 'khac' });
    expect(bad.ok).toBe(false);
    const good = parseStaffCustomer({
      customerName: 'Lê Minh An',
      phone: '0901 000 099',
      address: '12 đường Mẫu, Quận 1',
      note: 'Đặt qua Zalo',
      paymentMethod: 'bank',
    });
    expect(good.ok && good.value.phone).toBe('0901000099');
    expect(good.ok && good.value.paymentMethod).toBe('bank');
  });

  it('đơn một mẫu không có dòng chi tiết vẫn thành một dòng để sửa', () => {
    const lines = orderLineSources({
      productId: 7,
      productName: 'Vòng cho bé',
      unitPrice: 100000,
      quantity: 2,
      optionLabel: '5kg',
      subtotal: 200000,
      totalPrice: 190000,
      discountAmount: 10000,
      items: [],
    });
    expect(lines).toEqual([
      { productId: 7, productName: 'Vòng cho bé', unitPrice: 100000, quantity: 2, optionLabel: '5kg', lineTotal: 200000 },
    ]);
  });
});
