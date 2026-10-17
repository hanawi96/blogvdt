import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROUND_STEP,
  DEFAULT_TARGET_MARGIN,
  LOW_MARGIN_PERCENT,
  MAX_PRODUCT_PRICE,
  impactOfUnitCostChange,
  marginTone,
  parseRoundStep,
  parseTargetMargin,
  suggestedPrice,
} from './costing';

describe('ngưỡng biên lợi nhuận', () => {
  it('phân loại lỗ, thấp, ổn và chưa có', () => {
    expect(marginTone(null)).toBe('none');
    expect(marginTone(-5)).toBe('loss');
    expect(marginTone(0)).toBe('low');
    expect(marginTone(LOW_MARGIN_PERCENT - 1)).toBe('low');
    expect(marginTone(LOW_MARGIN_PERCENT)).toBe('ok');
    expect(marginTone(55)).toBe('ok');
  });
});

describe('thông số đọc từ giao diện', () => {
  it('biên mục tiêu: số nguyên 0-90, sai thì về mặc định', () => {
    expect(parseTargetMargin('35')).toBe(35);
    expect(parseTargetMargin('0')).toBe(0);
    expect(parseTargetMargin('90')).toBe(90);
    expect(parseTargetMargin('91')).toBe(DEFAULT_TARGET_MARGIN);
    expect(parseTargetMargin('-5')).toBe(DEFAULT_TARGET_MARGIN);
    expect(parseTargetMargin('abc')).toBe(DEFAULT_TARGET_MARGIN);
    expect(parseTargetMargin(null)).toBe(DEFAULT_TARGET_MARGIN);
  });

  it('bước làm tròn chỉ nhận giá trị cho phép', () => {
    expect(parseRoundStep('500')).toBe(500);
    expect(parseRoundStep('10000')).toBe(10000);
    expect(parseRoundStep('1')).toBe(1);
    expect(parseRoundStep('777')).toBe(DEFAULT_ROUND_STEP);
    expect(parseRoundStep('')).toBe(DEFAULT_ROUND_STEP);
  });
});

describe('giá bán đề xuất', () => {
  it('đạt đúng biên mục tiêu, không nhảy thêm một bước khi chia hết', () => {
    // 60.000 / (1 - 0,4) = 100.000 đúng.
    expect(suggestedPrice(60000, 40, 1000)).toBe(100000);
    expect(suggestedPrice(60000, 40, 1)).toBe(100000);
    expect(suggestedPrice(45000, 50, 1000)).toBe(90000);
  });

  it('làm tròn lên theo bước và luôn đạt biên tối thiểu', () => {
    // 75.000 / 0,6 = 125.000.
    expect(suggestedPrice(75000, 40, 1000)).toBe(125000);
    // 50.000 / 0,6 = 83.333,33 -> 84.000.
    expect(suggestedPrice(50000, 40, 1000)).toBe(84000);
    expect(suggestedPrice(50000, 40, 10000)).toBe(90000);
    const price = suggestedPrice(54321, 40, 1000);
    expect(price).not.toBeNull();
    if (price !== null) expect((price - 54321) / price).toBeGreaterThanOrEqual(0.4);
  });

  it('không đề xuất khi chưa có giá vốn hoặc vượt giới hạn', () => {
    expect(suggestedPrice(0, 40, 1000)).toBeNull();
    expect(suggestedPrice(-1, 40, 1000)).toBeNull();
    expect(suggestedPrice(MAX_PRODUCT_PRICE, 40, 1000)).toBeNull();
  });

  it('biên 0% thì bằng giá vốn làm tròn lên', () => {
    expect(suggestedPrice(54321, 0, 1000)).toBe(55000);
  });
});

describe('tác động khi đổi đơn giá nguyên liệu', () => {
  const rows = [
    { productId: 1, name: 'A', price: 150000, cost: 75000, quantity: 2, status: 'active' },
    { productId: 2, name: 'B', price: 100000, cost: 68000, quantity: 1, status: 'active' },
  ];

  it('tính vốn mới và biên mới cho từng sản phẩm', () => {
    const impact = impactOfUnitCostChange(rows, 10000, 15000);
    expect(impact.count).toBe(2);
    expect(impact.items[0]).toMatchObject({ deltaCost: 10000, newCost: 85000, marginBefore: 50, marginAfter: 43 });
    expect(impact.items[1]).toMatchObject({ deltaCost: 5000, newCost: 73000, marginBefore: 32, marginAfter: 27 });
    expect(impact.minDelta).toBe(5000);
    expect(impact.maxDelta).toBe(10000);
  });

  it('chỉ cảnh báo sản phẩm có biên thấp hoặc lỗ sau khi đổi, xếp tệ nhất trước', () => {
    const impact = impactOfUnitCostChange(rows, 10000, 15000);
    expect(impact.flagged.map((item) => item.productId)).toEqual([2]);
    // Giá 40.000: A còn biên 10%, B còn 2% (đều "thấp"), B tệ hơn nên đứng trước.
    const low = impactOfUnitCostChange(rows, 10000, 40000);
    expect(low.flagged.map((item) => [item.productId, item.toneAfter])).toEqual([
      [2, 'low'],
      [1, 'low'],
    ]);
    // Giá 60.000: cả hai lỗ (A -17%, B -18%), B tệ hơn nên đứng trước.
    const big = impactOfUnitCostChange(rows, 10000, 60000);
    expect(big.flagged.map((item) => [item.productId, item.toneAfter, item.marginAfter])).toEqual([
      [2, 'loss', -18],
      [1, 'loss', -17],
    ]);
  });

  it('giá giảm làm biên tăng và không có gì để cảnh báo', () => {
    const impact = impactOfUnitCostChange(rows, 10000, 8000);
    expect(impact.maxDelta).toBeLessThan(0);
    expect(impact.flagged).toEqual([]);
  });

  it('không có sản phẩm nào thì tất cả bằng 0', () => {
    expect(impactOfUnitCostChange([], 1, 2)).toMatchObject({ count: 0, minDelta: 0, maxDelta: 0, flagged: [] });
  });
});
