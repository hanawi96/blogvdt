import { describe, expect, it } from 'vitest';
import { orderProfit } from '../costs/order-costs';
import { aggregateProductGoodsMargins } from './breakdowns';
import { periodDayKeys, pnlQuickPresets, readPnlPeriod } from './period';
import { buildPnlWaterfall, buildPnlWaterfallSteps, pnlWaterfallIntegrity, visibleWaterfallSteps } from './waterfall';

describe('P&L integrity — đồng bộ số liệu', () => {
  it('waterfall field = công thức = từng cột biểu đồ', () => {
    const w = buildPnlWaterfall({
      orders: 5,
      costedOrders: 4,
      revenue: 1_200_000,
      costedRevenue: 1_000_000,
      costGoods: 400_000,
      costExtra: 50_000,
      shippingCost: 50_000,
      discountAmount: 20_000,
      adSpend: 100_000,
      laborBudget: 15_000_000,
    });
    expect(pnlWaterfallIntegrity(w)).toEqual({ ok: true });
    expect(w.grossProfit).toBe(500_000);
    expect(w.profitAfterAds).toBe(400_000);
    // laborBudget không trừ vào lãi
    expect(w.profitAfterAds).toBe(w.grossProfit - w.adSpend);
  });

  it('công thức lãi khớp orderProfit / dashboard profitExpr', () => {
    const order = { totalPrice: 300_000, costGoods: 100_000, costExtra: 20_000, shippingCost: 15_000 };
    expect(orderProfit(order)).toBe(165_000);
    const w = buildPnlWaterfall({
      orders: 1,
      costedOrders: 1,
      revenue: 300_000,
      costedRevenue: 300_000,
      costGoods: 100_000,
      costExtra: 20_000,
      shippingCost: 15_000,
      discountAmount: 0,
      adSpend: 0,
      laborBudget: 0,
    });
    expect(w.grossProfit).toBe(orderProfit(order));
  });

  it('ẩn cột phí 0 không làm lệch số các cột còn lại', () => {
    const w = buildPnlWaterfall({
      orders: 2,
      costedOrders: 2,
      revenue: 500_000,
      costedRevenue: 500_000,
      costGoods: 200_000,
      costExtra: 0,
      shippingCost: 0,
      discountAmount: 0,
      adSpend: 0,
      laborBudget: 0,
    });
    const visible = visibleWaterfallSteps(buildPnlWaterfallSteps(w));
    expect(visible.find((step) => step.id === 'grossProfit')?.amount).toBe(w.grossProfit);
    expect(visible.find((step) => step.id === 'profitAfterAds')?.amount).toBe(w.profitAfterAds);
    expect(visible.find((step) => step.id === 'costGoods')?.amount).toBe(w.costGoods);
    expect(visible.some((step) => step.id === 'costExtra')).toBe(false);
    expect(pnlWaterfallIntegrity(w)).toEqual({ ok: true });
  });

  it('tổng lãi nguồn = lãi gộp khi cộng các nhóm (mô phỏng)', () => {
    // Cùng công thức profitExpr trên từng đơn đã có vốn.
    const orders = [
      { source: 'web', totalPrice: 200_000, costGoods: 80_000, costExtra: 10_000, shippingCost: 10_000 },
      { source: 'zalo', totalPrice: 300_000, costGoods: 100_000, costExtra: 20_000, shippingCost: 0 },
      { source: 'web', totalPrice: 100_000, costGoods: 40_000, costExtra: 0, shippingCost: 5_000 },
    ];
    const bySource = new Map<string, number>();
    let gross = 0;
    for (const row of orders) {
      const profit = orderProfit(row)!;
      gross += profit;
      bySource.set(row.source, (bySource.get(row.source) ?? 0) + profit);
    }
    const w = buildPnlWaterfall({
      orders: 3,
      costedOrders: 3,
      revenue: 600_000,
      costedRevenue: 600_000,
      costGoods: 220_000,
      costExtra: 30_000,
      shippingCost: 15_000,
      discountAmount: 0,
      adSpend: 0,
      laborBudget: 0,
    });
    expect(w.grossProfit).toBe(gross);
    expect([...bySource.values()].reduce((a, b) => a + b, 0)).toBe(w.grossProfit);
  });

  it('preset nhanh → periodDayKeys khớp from/to và biên start/end', () => {
    const now = Date.parse('2026-11-28T12:00:00+07:00');
    for (const preset of pnlQuickPresets(now)) {
      const period = readPnlPeriod(new URLSearchParams(`from=${preset.from}&to=${preset.to}`), now);
      const days = periodDayKeys(period.from, period.to)!;
      expect(days[0]).toBe(preset.from);
      expect(days.at(-1)).toBe(preset.to);
      expect(period.start).toBe(Date.parse(`${preset.from}T00:00:00+07:00`));
      expect(period.end - period.start).toBe(days.length * 86_400_000);
    }
  });

  it('phân bổ vốn SP: tổng share đúng bằng cost_goods đơn', () => {
    const ranks = aggregateProductGoodsMargins(
      [
        { orderId: 1, productId: 1, name: 'A', quantity: 1, lineTotal: 100_000, costGoods: 100_000 },
        { orderId: 1, productId: 2, name: 'B', quantity: 1, lineTotal: 100_000, costGoods: 100_000 },
        { orderId: 1, productId: 3, name: 'C', quantity: 1, lineTotal: 100_000, costGoods: 100_000 },
      ],
      [],
      10,
    );
    expect(ranks.reduce((sum, row) => sum + row.goodsCost, 0)).toBe(100_000);
  });
});
