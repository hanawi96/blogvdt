import { describe, expect, it } from 'vitest';
import {
  FREE_SHIP_BRACELET_MIN,
  baseCustomerShippingFee,
  productQualifiesFreeShip,
  productShipBadge,
  qualifiesFreeShip,
  resolveCustomerShippingFee,
  shipGroupOf,
} from './customer-fee';

describe('shipGroupOf', () => {
  it('nhận diện bi bạc và bán kèm theo slug', () => {
    expect(shipGroupOf('bi-charm-bac')).toBe('silver');
    expect(shipGroupOf('san-pham-ban-kem')).toBe('addon');
    expect(shipGroupOf('vong-tron')).toBe('bracelet');
    expect(shipGroupOf('mix-charm-ran')).toBe('bracelet');
    expect(shipGroupOf('')).toBe('other');
    expect(shipGroupOf(null)).toBe('other');
  });
});

describe('qualifiesFreeShip', () => {
  it('vòng từ 100.000đ được miễn ship', () => {
    expect(qualifiesFreeShip([{ group: 'bracelet', lineTotal: FREE_SHIP_BRACELET_MIN }])).toBe(true);
    expect(qualifiesFreeShip([{ group: 'bracelet', lineTotal: 150_000 }])).toBe(true);
    expect(qualifiesFreeShip([{ group: 'bracelet', lineTotal: 60_000 }, { group: 'bracelet', lineTotal: 50_000 }])).toBe(true);
  });

  it('vòng dưới 100.000đ phải trả ship', () => {
    expect(qualifiesFreeShip([{ group: 'bracelet', lineTotal: 99_000 }])).toBe(false);
  });

  it('vòng dưới 100.000đ + bán kèm được miễn ship', () => {
    expect(
      qualifiesFreeShip([
        { group: 'bracelet', lineTotal: 69_000 },
        { group: 'addon', lineTotal: 25_000 },
      ]),
    ).toBe(true);
  });

  it('bi charm bạc luôn mất ship', () => {
    expect(qualifiesFreeShip([{ group: 'silver', lineTotal: 200_000 }])).toBe(false);
    expect(
      qualifiesFreeShip([
        { group: 'bracelet', lineTotal: 150_000 },
        { group: 'silver', lineTotal: 50_000 },
      ]),
    ).toBe(false);
    expect(
      qualifiesFreeShip([
        { group: 'bracelet', lineTotal: 69_000 },
        { group: 'addon', lineTotal: 20_000 },
        { group: 'silver', lineTotal: 30_000 },
      ]),
    ).toBe(false);
  });

  it('chỉ bán kèm hoặc giỏ trống không miễn', () => {
    expect(qualifiesFreeShip([])).toBe(false);
    expect(qualifiesFreeShip([{ group: 'addon', lineTotal: 40_000 }])).toBe(false);
    expect(qualifiesFreeShip([{ group: 'other', lineTotal: 120_000 }])).toBe(false);
  });
});

describe('productShipBadge', () => {
  it('vòng ≥ 100k miễn; vòng rẻ gợi ý mua kèm; bạc/bán kèm không badge', () => {
    expect(productShipBadge(FREE_SHIP_BRACELET_MIN, 'vong-tron')).toBe('free');
    expect(productShipBadge(89_000, 'vong-tron')).toBe('with-addon');
    expect(productShipBadge(200_000, 'bi-charm-bac')).toBe('none');
    expect(productShipBadge(40_000, 'san-pham-ban-kem')).toBe('none');
    expect(productQualifiesFreeShip(FREE_SHIP_BRACELET_MIN, 'vong-tron')).toBe(true);
    expect(productQualifiesFreeShip(89_000, 'vong-tron')).toBe(false);
  });
});

describe('resolveCustomerShippingFee', () => {
  it('miễn thì fee 0, không miễn thì lấy baseFee', () => {
    expect(resolveCustomerShippingFee({ lines: [{ group: 'bracelet', lineTotal: 150_000 }], baseFee: 19_000 })).toEqual({
      free: true,
      fee: 0,
    });
    expect(resolveCustomerShippingFee({ lines: [{ group: 'bracelet', lineTotal: 50_000 }], baseFee: 19_000 })).toEqual({
      free: false,
      fee: 19_000,
    });
    expect(resolveCustomerShippingFee({ lines: [{ group: 'silver', lineTotal: 200_000 }], baseFee: 19_000 })).toEqual({
      free: false,
      fee: 19_000,
    });
  });
});

describe('baseCustomerShippingFee', () => {
  it('cộng khoản ship cố định đang bật', () => {
    expect(
      baseCustomerShippingFee([
        { name: 'Phí vận chuyển', kind: 'fixed', value: 19_000, active: true },
        { name: 'Túi đỏ', kind: 'fixed', value: 5_000, active: true },
        { name: 'Phí ship', kind: 'fixed', value: 1_000, active: false },
      ]),
    ).toBe(19_000);
  });
});
