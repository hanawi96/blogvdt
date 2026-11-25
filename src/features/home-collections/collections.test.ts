import { describe, expect, it } from 'vitest';
import {
  addonUnitWithBundleOffers,
  catalogUnitWithComboOffers,
  comboSaveTotal,
  comboUnitPrice,
  encodeBraceletGroups,
  hasComboDiscount,
  hasRuleDiscount,
  HOME_COLLECTION_BRACELET_ADDON_MAX,
  HOME_COLLECTION_KINDS,
  HOME_COLLECTION_MAX,
  HOME_COLLECTION_PAIR_MAX,
  HOME_COLLECTION_PRODUCT_MAX,
  parseBraceletGroups,
  parseComboDiscountInput,
  validateBraceletGroups,
} from './collections';

describe('home collections constants', () => {
  it('giới hạn khối và SP để trang chủ nhẹ', () => {
    expect(HOME_COLLECTION_MAX).toBe(3);
    expect(HOME_COLLECTION_PRODUCT_MAX).toBe(6);
    expect(HOME_COLLECTION_PAIR_MAX).toBe(3);
    expect(HOME_COLLECTION_BRACELET_ADDON_MAX).toBe(3);
    expect(HOME_COLLECTION_KINDS).toEqual(['products', 'pair_discount', 'bracelet_addon']);
  });
});

describe('parseBraceletGroups', () => {
  it('đọc format mới: 1 chính + nhiều phụ', () => {
    expect(
      parseBraceletGroups(
        JSON.stringify([
          { primary: 10, addons: [21, 22] },
          { primary: 11, addons: [23] },
        ]),
      ),
    ).toEqual([
      { primary: 10, addons: [21, 22] },
      { primary: 11, addons: [23] },
    ]);
  });

  it('migrate legacy [chính, phụ, chính, phụ]', () => {
    expect(parseBraceletGroups(JSON.stringify([10, 21, 11, 22]))).toEqual([
      { primary: 10, addons: [21] },
      { primary: 11, addons: [22] },
    ]);
  });

  it('bỏ phụ trùng / trùng chính và cắt theo max', () => {
    expect(
      parseBraceletGroups(
        JSON.stringify([
          { primary: 10, addons: [21, 21, 10, 22, 23, 24] },
          { primary: 11, addons: [25] },
          { primary: 12, addons: [26] },
          { primary: 13, addons: [27] },
        ]),
      ),
    ).toEqual([
      { primary: 10, addons: [21, 22, 23] },
      { primary: 11, addons: [25] },
      { primary: 12, addons: [26] },
    ]);
  });

  it('bỏ nhóm không hợp lệ và JSON hỏng', () => {
    expect(parseBraceletGroups(JSON.stringify([{ primary: 10, addons: [] }]))).toEqual([]);
    expect(parseBraceletGroups(JSON.stringify([{ primary: 0, addons: [1] }]))).toEqual([]);
    expect(parseBraceletGroups('not-json')).toEqual([]);
    expect(parseBraceletGroups('[]')).toEqual([]);
  });

  it('encode rồi parse giữ cấu trúc — nhiều combo', () => {
    const groups = [
      { primary: 10, addons: [21, 22] },
      { primary: 11, addons: [23] },
      { primary: 12, addons: [24, 25] },
    ];
    expect(parseBraceletGroups(encodeBraceletGroups(groups))).toEqual(groups);
  });

  it('nhận id dạng chuỗi và encodeURIComponent từ form', () => {
    expect(
      parseBraceletGroups(
        JSON.stringify([
          { primary: '10', addons: ['21', '22'] },
          { primary: '11', addons: ['23'] },
        ]),
      ),
    ).toEqual([
      { primary: 10, addons: [21, 22] },
      { primary: 11, addons: [23] },
    ]);
    const encoded = encodeURIComponent(
      JSON.stringify([
        { primary: 10, addons: [21] },
        { primary: 11, addons: [22] },
      ]),
    );
    expect(parseBraceletGroups(encoded)).toEqual([
      { primary: 10, addons: [21] },
      { primary: 11, addons: [22] },
    ]);
  });
});

describe('validateBraceletGroups', () => {
  const picks = new Map(
    [10, 11, 21, 22, 23].map((id) => [
      id,
      { id, name: `#${id}`, slug: `p-${id}`, categorySlug: 'c', coverUrl: null },
    ]),
  );

  it('cho phép cùng bán kèm ở nhiều combo', () => {
    const result = validateBraceletGroups(
      [
        { primary: 10, addons: [21, 22] },
        { primary: 11, addons: [21, 22] },
      ],
      picks,
    );
    expect(result).toEqual({
      ok: true,
      groups: [
        { primary: 10, addons: [21, 22] },
        { primary: 11, addons: [21, 22] },
      ],
    });
  });

  it('không cho trùng vòng chính', () => {
    const result = validateBraceletGroups(
      [
        { primary: 10, addons: [21] },
        { primary: 10, addons: [22] },
      ],
      picks,
    );
    expect(result.ok).toBe(false);
  });
});

describe('combo discount', () => {
  it('parse: trống / % / số tiền / lỗi', () => {
    expect(parseComboDiscountInput('', '')).toEqual({ ok: true });
    expect(parseComboDiscountInput('percent', '10')).toEqual({
      ok: true,
      discountType: 'percent',
      discountValue: 10,
    });
    expect(parseComboDiscountInput('amount', '20000')).toEqual({
      ok: true,
      discountType: 'amount',
      discountValue: 20000,
    });
    expect(parseComboDiscountInput('', '10').ok).toBe(false);
    expect(parseComboDiscountInput('percent', '0').ok).toBe(false);
    expect(parseComboDiscountInput('percent', '80').ok).toBe(false);
  });

  it('tính đơn giá và tiết kiệm khi đủ số lượng', () => {
    const percent = { buyQty: 2, discountType: 'percent' as const, discountValue: 10 };
    const amount = { buyQty: 3, discountType: 'amount' as const, discountValue: 20000 };
    expect(comboUnitPrice(100000, percent)).toBe(90000);
    expect(comboUnitPrice(100000, amount)).toBe(80000);
    expect(comboSaveTotal(100000, 1, percent)).toBe(0);
    expect(comboSaveTotal(100000, 2, percent)).toBe(20000);
    expect(hasComboDiscount({ buyQty: 2, discountType: 'percent', discountValue: 10 })).toBe(true);
    expect(hasComboDiscount({ buyQty: 2 })).toBe(false);
    expect(hasRuleDiscount({ discountType: 'percent', discountValue: 10 })).toBe(true);

    const offers = new Map([[7, [percent, amount]]]);
    expect(catalogUnitWithComboOffers(100000, 7, 1, offers)).toBe(100000);
    expect(catalogUnitWithComboOffers(100000, 7, 2, offers)).toBe(90000);
    // qty≥3: chọn offer thấp hơn (amount 80k vs percent 90k)
    expect(catalogUnitWithComboOffers(100000, 7, 3, offers)).toBe(80000);
  });

  it('giảm bán kèm chỉ khi đơn có vòng chính khớp', () => {
    const bundles = [
      {
        primaryId: 10,
        addonIds: [21, 22],
        discountType: 'percent' as const,
        discountValue: 20,
      },
    ];
    expect(addonUnitWithBundleOffers(50000, 21, new Set([10, 21]), bundles)).toBe(40000);
    expect(addonUnitWithBundleOffers(50000, 21, new Set([21]), bundles)).toBe(50000);
    expect(addonUnitWithBundleOffers(50000, 99, new Set([10, 99]), bundles)).toBe(50000);
    expect(addonUnitWithBundleOffers(50000, 22, new Set([10, 22]), [
      { ...bundles[0]!, discountType: 'amount', discountValue: 15000 },
    ])).toBe(35000);
  });
});
