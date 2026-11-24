import { describe, expect, it } from 'vitest';
import { costSnapshotOf, encodeCostLines, extraCostOf, formatPercentBp, goodsCostOf, isShippingOrderCost, orderProfit, orderShippingCost, parseCostLines, parseOrderCostValue, parsePercentBp } from './order-costs';

describe('phần trăm', () => {
  it('đọc 1,5% thành 150 phần vạn', () => {
    expect(parsePercentBp('1,5')).toBe(150);
    expect(parsePercentBp('1.5')).toBe(150);
    expect(parsePercentBp('2')).toBe(200);
    expect(parsePercentBp('0,015')).toBeNull();
    expect(parsePercentBp('100')).toBe(10000);
    expect(parsePercentBp('101')).toBeNull();
    expect(parsePercentBp('abc')).toBeNull();
  });

  it('hiển thị lại gọn', () => {
    expect(formatPercentBp(150)).toBe('1,5');
    expect(formatPercentBp(200)).toBe('2');
    expect(formatPercentBp(125)).toBe('1,25');
  });

  it('chọn đúng cách đọc theo loại', () => {
    expect(parseOrderCostValue('fixed', '3.470')).toBe(3470);
    expect(parseOrderCostValue('percent', '1,5')).toBe(150);
  });
});

describe('chi phí theo đơn', () => {
  const costs = [
    { kind: 'fixed' as const, value: 3470 },
    { kind: 'fixed' as const, value: 16000 },
    { kind: 'percent' as const, value: 150 },
  ];

  it('một đơn nhiều vòng vẫn chỉ tính hộp một lần', () => {
    expect(extraCostOf(costs, 0)).toBe(19470);
    expect(extraCostOf(costs, 200000)).toBe(19470 + 3000);
  });

  it('làm tròn phần trăm đến đồng', () => {
    expect(extraCostOf([{ kind: 'percent', value: 150 }], 12345)).toBe(185);
  });

  it('không có khoản nào thì bằng 0', () => {
    expect(extraCostOf([], 100000)).toBe(0);
  });
});

describe('giá vốn cả đơn', () => {
  const byProduct = new Map([[1, 50000], [2, 30000]]);

  it('cộng giá vốn từng vòng nhân số lượng', () => {
    expect(goodsCostOf([{ productId: 1, quantity: 2 }, { productId: 2, quantity: 1 }], byProduct)).toBe(130000);
  });

  it('thiếu công thức hoặc sản phẩm đã xóa thì vốn 0', () => {
    expect(goodsCostOf([{ productId: 1, quantity: 1 }, { productId: 9, quantity: 1 }], byProduct)).toBe(50000);
    expect(goodsCostOf([{ productId: null, quantity: 2 }], byProduct)).toBe(0);
    expect(goodsCostOf([], byProduct)).toBeNull();
  });
});

describe('lợi nhuận đơn', () => {
  it('doanh thu trừ giá vốn và chi phí đơn', () => {
    expect(orderProfit({ totalPrice: 300000, costGoods: 130000, costExtra: 22470 })).toBe(147530);
    expect(orderProfit({ totalPrice: 61000, costGoods: 20000, costExtra: 0, shippingCost: 16000 })).toBe(25000);
  });

  it('đơn cũ chưa có số liệu thì không tính', () => {
    expect(orderProfit({ totalPrice: 300000, costGoods: null, costExtra: 1000 })).toBeNull();
    expect(orderProfit({ totalPrice: 300000, costGoods: 1000, costExtra: null })).toBeNull();
  });
});

describe('ảnh chụp chi phí lúc đặt', () => {
  const costs = [
    { name: 'Hộp', kind: 'fixed' as const, value: 5000, active: true },
    { name: 'Thuế', kind: 'percent' as const, value: 1000, active: true },
    { name: 'Tắt', kind: 'fixed' as const, value: 9000, active: false },
  ];

  it('lợi nhuận bằng số phải trả trừ giá vốn và từng khoản đang bật', () => {
    const shot = costSnapshotOf(
      [{ name: 'Vòng trơn', productId: 1, quantity: 2 }],
      new Map([[1, 40000]]),
      costs,
      180000,
    );
    expect(shot.costGoods).toBe(80000);
    expect(shot.extra).toEqual([
      { name: 'Hộp', kind: 'fixed', rate: 5000, amount: 5000 },
      { name: 'Thuế', kind: 'percent', rate: 1000, amount: 18000 },
    ]);
    expect(shot.costExtra).toBe(23000);
    expect(orderProfit({ totalPrice: 180000, costGoods: shot.costGoods, costExtra: shot.costExtra })).toBe(77000);
    expect(parseCostLines(encodeCostLines(shot))).toEqual({ goods: shot.goods, missing: [], extra: shot.extra });
  });

  it('phí vận chuyển tách khỏi chi phí đơn để không trừ hai lần', () => {
    const shot = costSnapshotOf(
      [{ name: 'Vòng trơn', productId: 1, quantity: 1 }],
      new Map([[1, 40000]]),
      [
        { name: 'Hộp', kind: 'fixed', value: 5000, active: true },
        { name: 'Phí vận chuyển', kind: 'fixed', value: 19000, active: true },
        { name: 'Phí ship', kind: 'fixed', value: 1000, active: false },
      ],
      100000,
    );
    expect(isShippingOrderCost('Phí vận chuyển')).toBe(true);
    expect(isShippingOrderCost('Túi đỏ')).toBe(false);
    expect(shot.extra.map((line) => line.name)).toEqual(['Hộp']);
    expect(shot.costExtra).toBe(5000);
    expect(shot.shippingCost).toBe(19000);
    expect(orderProfit({ totalPrice: 100000, costGoods: shot.costGoods, costExtra: shot.costExtra, shippingCost: shot.shippingCost })).toBe(36000);
    expect(orderShippingCost(0, [{ name: 'Phí vận chuyển', amount: 19000 }])).toBe(19000);
    expect(orderShippingCost(19000, [{ name: 'Phí vận chuyển', amount: 19000 }])).toBe(19000);
  });

  it('thiếu công thức thì vốn 0, vẫn tính lãi với chi phí đơn', () => {
    const shot = costSnapshotOf([{ name: 'Vòng lạ', productId: 9, quantity: 1 }], new Map(), costs, 100000);
    expect(shot.goods).toEqual([{ name: 'Vòng lạ', quantity: 1, unitCost: 0, amount: 0 }]);
    expect(shot.costGoods).toBe(0);
    expect(shot.missing).toEqual(['Vòng lạ']);
    expect(shot.costExtra).toBe(15000);
    expect(orderProfit({ totalPrice: 100000, costGoods: shot.costGoods, costExtra: shot.costExtra })).toBe(85000);
  });

  it('dòng thiếu công thức tính vốn 0, vẫn cộng tổng với dòng đã có', () => {
    const shot = costSnapshotOf(
      [
        { name: 'Vòng trơn', productId: 1, quantity: 1 },
        { name: 'Vòng lạ', productId: 9, quantity: 1 },
      ],
      new Map([[1, 40000]]),
      costs,
      100000,
    );
    expect(shot.goods).toEqual([
      { name: 'Vòng trơn', quantity: 1, unitCost: 40000, amount: 40000 },
      { name: 'Vòng lạ', quantity: 1, unitCost: 0, amount: 0 },
    ]);
    expect(shot.missing).toEqual(['Vòng lạ']);
    expect(shot.costGoods).toBe(40000);
  });

  it('unitCost ghi đè công thức — dòng tùy chỉnh vẫn có lãi', () => {
    const recipes = new Map([
      [
        1,
        [
          { name: 'Hạt', quantity: 10, unitCost: 2000 },
          { name: 'Dây', quantity: 1, unitCost: 20000 },
        ],
      ],
    ]);
    const shot = costSnapshotOf(
      [
        { name: 'Vòng A + bi bạc', productId: 1, quantity: 1, unitCost: 55000 },
        { name: 'Vòng trơn', productId: 1, quantity: 1 },
      ],
      new Map([[1, 40000]]),
      costs,
      200000,
      recipes,
    );
    expect(shot.missing).toEqual([]);
    expect(shot.costGoods).toBe(95000);
    expect(shot.goods).toEqual([
      { name: 'Vòng A + bi bạc', quantity: 1, unitCost: 55000, amount: 55000 },
      {
        name: 'Vòng trơn',
        quantity: 1,
        unitCost: 40000,
        amount: 40000,
        materials: [
          { name: 'Hạt', quantity: 10, unitCost: 2000, amount: 20000 },
          { name: 'Dây', quantity: 1, unitCost: 20000, amount: 20000 },
        ],
      },
    ]);
  });

  it('chụp nguyên liệu theo số lượng dòng đơn', () => {
    const shot = costSnapshotOf(
      [{ name: 'Vòng trơn', productId: 1, quantity: 2 }],
      new Map([[1, 40000]]),
      costs,
      180000,
      new Map([[1, [{ name: 'Hạt', quantity: 10, unitCost: 2000 }]]]),
    );
    expect(shot.goods[0]?.materials).toEqual([{ name: 'Hạt', quantity: 20, unitCost: 2000, amount: 40000 }]);
    expect(parseCostLines(encodeCostLines(shot))?.goods[0]?.materials).toEqual(shot.goods[0]?.materials);
  });
});
