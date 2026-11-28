import { describe, expect, it } from 'vitest';
import { aggregateProductGoodsMargins } from './breakdowns';

describe('aggregateProductGoodsMargins', () => {
  it('phân bổ vốn hàng theo tỷ lệ doanh thu dòng', () => {
    const ranks = aggregateProductGoodsMargins(
      [
        { orderId: 1, productId: 10, name: 'Vòng A', quantity: 1, lineTotal: 100_000, costGoods: 40_000 },
        { orderId: 1, productId: 20, name: 'Vòng B', quantity: 1, lineTotal: 100_000, costGoods: 40_000 },
        { orderId: 2, productId: 10, name: 'Vòng A', quantity: 2, lineTotal: 200_000, costGoods: 50_000 },
      ],
      [],
      10,
    );
    expect(ranks[0]).toMatchObject({ productId: 10, sold: 3, revenue: 300_000, goodsCost: 70_000, contribution: 230_000 });
    expect(ranks[1]).toMatchObject({ productId: 20, sold: 1, revenue: 100_000, goodsCost: 20_000, contribution: 80_000 });
  });

  it('tổng vốn phân bổ đúng bằng cost_goods từng đơn (kể cả làm tròn)', () => {
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

  it('cộng đơn legacy và giới hạn top', () => {
    const ranks = aggregateProductGoodsMargins(
      [],
      [
        { productId: 1, name: 'A', quantity: 1, revenue: 90_000, costGoods: 30_000 },
        { productId: 2, name: 'B', quantity: 1, revenue: 80_000, costGoods: 10_000 },
        { productId: 3, name: 'C', quantity: 1, revenue: 50_000, costGoods: 40_000 },
      ],
      2,
    );
    expect(ranks).toHaveLength(2);
    expect(ranks[0]?.productId).toBe(2);
    expect(ranks[1]?.productId).toBe(1);
  });
});
