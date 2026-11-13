import { describe, expect, it } from 'vitest';
import { applyWeightPrice, isValidWeight, weightChips, weightExtras, weightOptionLabel, weightPriceFactor, weightSurchargeLabel, weightSurchargePercent } from './weight';

describe('phụ thu theo cân nặng', () => {
  it('phần trăm phụ thu theo cân nặng + giá gốc', () => {
    // Chip và cân nặng không hợp lệ: không phụ thu
    expect(weightSurchargePercent('Chưa sinh', 200000)).toBe(0);
    expect(weightSurchargePercent('15kg', 200000)).toBe(0);
    expect(weightSurchargePercent('', 200000)).toBe(0);
    // 16–35kg
    expect(weightSurchargePercent('16kg', 100000)).toBe(15); // <150k
    expect(weightSurchargePercent('35kg', 149999)).toBe(15);
    expect(weightSurchargePercent('16kg', 150000)).toBe(12); // 150k–<300k
    expect(weightSurchargePercent('35kg', 299999)).toBe(12);
    expect(weightSurchargePercent('16kg', 300000)).toBe(10); // >=300k
    // 36kg+
    expect(weightSurchargePercent('36kg', 100000)).toBe(20);
    expect(weightSurchargePercent('70kg', 149999)).toBe(20);
    expect(weightSurchargePercent('36kg', 150000)).toBe(15);
    expect(weightSurchargePercent('36kg', 299999)).toBe(15);
    expect(weightSurchargePercent('36kg', 300000)).toBe(10);
  });

  it('hệ số giá', () => {
    expect(weightPriceFactor('15kg', 200000)).toBe(1);
    expect(weightPriceFactor('16kg', 100000)).toBeCloseTo(1.15);
    expect(weightPriceFactor('36kg', 100000)).toBeCloseTo(1.2);
  });

  it('đơn giá sau phụ thu, làm tròn nghìn, trên giá gốc', () => {
    expect(applyWeightPrice(200000, '15kg')).toBe(200000);
    // 200k: 16–35kg -> 12% = 224000; 36kg+ -> 15% = 230000
    expect(applyWeightPrice(200000, '16kg')).toBe(224000);
    expect(applyWeightPrice(200000, '36kg')).toBe(230000);
    // 100k (<150k): 16–35kg +15% = 115000; 36kg+ +20% = 120000
    expect(applyWeightPrice(100000, '16kg')).toBe(115000);
    expect(applyWeightPrice(100000, '36kg')).toBe(120000);
    // 300k (>=300k): cả hai bậc +10% = 330000
    expect(applyWeightPrice(300000, '16kg')).toBe(330000);
    expect(applyWeightPrice(300000, '36kg')).toBe(330000);
    // làm tròn nghìn: 149000 +15% = 171350 -> 171000
    expect(applyWeightPrice(149000, '16kg')).toBe(171000);
  });

  it('nhãn phụ thu và option dropdown theo giá', () => {
    expect(weightSurchargeLabel('15kg', 200000)).toBeNull();
    expect(weightSurchargeLabel('16kg', 100000)).toBe('+15%');
    expect(weightSurchargeLabel('36kg', 300000)).toBe('+10%');
    expect(weightOptionLabel('16kg', 100000)).toBe('16kg - (giá tăng 15%)');
    expect(weightOptionLabel('36kg', 200000)).toBe('36kg - (giá tăng 15%)');
    expect(weightOptionLabel('16kg', 300000)).toBe('16kg - (giá tăng 10%)');
  });

  it('validate chấp nhận cả chip và mốc lớn 16–70kg', () => {
    expect(isValidWeight('baby', '15kg')).toBe(true);
    expect(isValidWeight('baby', 'Chưa sinh')).toBe(true);
    expect(isValidWeight('baby', '16kg')).toBe(true);
    expect(isValidWeight('baby', '70kg')).toBe(true);
    expect(isValidWeight('baby', '71kg')).toBe(false);
    expect(isValidWeight('baby', '0kg')).toBe(false);
    expect(isValidWeight('baby', '')).toBe(false);
    expect(isValidWeight('none', '')).toBe(true);
    expect(isValidWeight('none', '5kg')).toBe(false);
  });

  it('chip tới 15kg, extras 16–70kg', () => {
    const chips = weightChips('baby');
    expect(chips[0]).toBe('Chưa sinh');
    expect(chips[chips.length - 1]).toBe('15kg');
    expect(chips).not.toContain('16kg');
    const extras = weightExtras('baby');
    expect(extras[0]).toBe('16kg');
    expect(extras[extras.length - 1]).toBe('70kg');
    expect(extras.length).toBe(55);
    expect(weightExtras('none')).toEqual([]);
  });
});
