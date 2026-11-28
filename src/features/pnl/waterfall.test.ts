import { describe, expect, it } from 'vitest';
import {
  buildPnlWaterfall,
  buildPnlWaterfallSteps,
  formatWaterfallAxis,
  visibleWaterfallSteps,
  waterfallValueDomain,
} from './waterfall';

describe('buildPnlWaterfall', () => {
  it('tính lãi gộp từ doanh thu có vốn; không trừ laborBudget', () => {
    const result = buildPnlWaterfall({
      orders: 10,
      costedOrders: 8,
      revenue: 5_000_000,
      costedRevenue: 4_000_000,
      costGoods: 1_500_000,
      costExtra: 200_000,
      shippingCost: 300_000,
      discountAmount: 100_000,
      adSpend: 400_000,
      laborBudget: 15_000_000,
    });
    expect(result.grossProfit).toBe(2_000_000);
    expect(result.profitAfterAds).toBe(1_600_000);
    expect(result.laborBudget).toBe(15_000_000);
    expect(result.aov).toBe(500_000);
    expect(result.grossMarginPercent).toBe(50);
    expect(result.discountAmount).toBe(100_000);
  });

  it('không có đơn: aov và biên null', () => {
    const result = buildPnlWaterfall({
      orders: 0,
      costedOrders: 0,
      revenue: 0,
      costedRevenue: 0,
      costGoods: 0,
      costExtra: 0,
      shippingCost: 0,
      discountAmount: 0,
      adSpend: 0,
      laborBudget: 0,
    });
    expect(result.grossProfit).toBe(0);
    expect(result.profitAfterAds).toBe(0);
    expect(result.aov).toBeNull();
    expect(result.grossMarginPercent).toBeNull();
  });

  it('đơn thiếu vốn không làm lãi ảo trên phần chưa có cost', () => {
    const result = buildPnlWaterfall({
      orders: 5,
      costedOrders: 3,
      revenue: 1_000_000,
      costedRevenue: 600_000,
      costGoods: 200_000,
      costExtra: 50_000,
      shippingCost: 50_000,
      discountAmount: 0,
      adSpend: 0,
      laborBudget: 0,
    });
    expect(result.orders).toBe(5);
    expect(result.costedOrders).toBe(3);
    expect(result.grossProfit).toBe(300_000);
    expect(result.grossMarginPercent).toBe(50);
  });

  it('ads / laborBudget âm được kẹp về 0', () => {
    const result = buildPnlWaterfall({
      orders: 1,
      costedOrders: 1,
      revenue: 100_000,
      costedRevenue: 100_000,
      costGoods: 10_000,
      costExtra: 0,
      shippingCost: 0,
      discountAmount: 0,
      adSpend: -1,
      laborBudget: -5,
    });
    expect(result.adSpend).toBe(0);
    expect(result.laborBudget).toBe(0);
    expect(result.profitAfterAds).toBe(90_000);
  });
});

describe('buildPnlWaterfallSteps', () => {
  it('cột cost treo đúng mức chạy; result neo 0', () => {
    const steps = buildPnlWaterfallSteps({
      costedRevenue: 1_000_000,
      costGoods: 400_000,
      costExtra: 50_000,
      shippingCost: 50_000,
      grossProfit: 500_000,
      adSpend: 100_000,
      profitAfterAds: 400_000,
    });
    expect(steps.map((step) => step.id)).toEqual([
      'costedRevenue',
      'costGoods',
      'costExtra',
      'shippingCost',
      'grossProfit',
      'adSpend',
      'profitAfterAds',
    ]);
    expect(steps[0]).toMatchObject({ kind: 'total', low: 0, high: 1_000_000 });
    expect(steps[1]).toMatchObject({ kind: 'cost', low: 600_000, high: 1_000_000, amount: 400_000 });
    expect(steps[2]).toMatchObject({ low: 550_000, high: 600_000 });
    expect(steps[3]).toMatchObject({ low: 500_000, high: 550_000 });
    expect(steps[4]).toMatchObject({ kind: 'result', low: 0, high: 500_000 });
    expect(steps[5]).toMatchObject({ kind: 'cost', low: 400_000, high: 500_000 });
    expect(steps[6]).toMatchObject({ kind: 'result', low: 0, high: 400_000 });
  });

  it('lãi âm vẫn có miền giá trị hợp lệ', () => {
    const steps = buildPnlWaterfallSteps({
      costedRevenue: 100_000,
      costGoods: 80_000,
      costExtra: 20_000,
      shippingCost: 30_000,
      grossProfit: -30_000,
      adSpend: 10_000,
      profitAfterAds: -40_000,
    });
    const domain = waterfallValueDomain(steps);
    expect(domain.min).toBeLessThan(0);
    expect(domain.max).toBeGreaterThan(0);
    expect(formatWaterfallAxis(1_500_000)).toBe('1.5tr');
    expect(formatWaterfallAxis(-12_000)).toBe('−12k');
  });

  it('ẩn cột chi phí 0 trên biểu đồ', () => {
    const steps = buildPnlWaterfallSteps({
      costedRevenue: 100_000,
      costGoods: 40_000,
      costExtra: 0,
      shippingCost: 0,
      grossProfit: 60_000,
      adSpend: 0,
      profitAfterAds: 60_000,
    });
    expect(visibleWaterfallSteps(steps).map((step) => step.id)).toEqual([
      'costedRevenue',
      'costGoods',
      'grossProfit',
      'profitAfterAds',
    ]);
  });
});
