import { describe, expect, it } from 'vitest';
import { RECIPE_MAX_LINES, RECIPE_MAX_QUANTITY, lineCost, parseRecipe, profitOf, recipeCost, resolveRecipeLines, type MaterialOption } from './costing';

describe('giá vốn từ công thức', () => {
  it('nhân số lượng với đơn giá và cộng các dòng', () => {
    expect(lineCost(2500, 12)).toBe(30000);
    expect(
      recipeCost([
        { unitCost: 35000, quantity: 1 },
        { unitCost: 2500, quantity: 12 },
        { unitCost: 10000, quantity: 1 },
      ]),
    ).toBe(75000);
    expect(recipeCost([])).toBe(0);
  });

  it('lợi nhuận và biên, kể cả lỗ và giá bán bằng 0', () => {
    expect(profitOf(150000, 90000)).toEqual({ profit: 60000, marginPercent: 40 });
    expect(profitOf(100000, 120000)).toEqual({ profit: -20000, marginPercent: -20 });
    expect(profitOf(0, 5000)).toEqual({ profit: -5000, marginPercent: null });
  });
});

describe('đọc công thức từ form', () => {
  it('nhận danh sách hợp lệ và danh sách rỗng', () => {
    expect(parseRecipe(['3', '7'], ['2', '12'])).toEqual({
      ok: true,
      lines: [
        { materialId: 3, quantity: 2 },
        { materialId: 7, quantity: 12 },
      ],
    });
    expect(parseRecipe([], [])).toEqual({ ok: true, lines: [] });
  });

  it('từ chối lệch độ dài, id sai, số lượng sai, trùng nguyên liệu', () => {
    expect(parseRecipe(['1'], []).ok).toBe(false);
    expect(parseRecipe(['abc'], ['1']).ok).toBe(false);
    expect(parseRecipe(['0'], ['1']).ok).toBe(false);
    expect(parseRecipe(['1'], ['0']).ok).toBe(false);
    expect(parseRecipe(['1'], ['1.5']).ok).toBe(false);
    expect(parseRecipe(['1'], [String(RECIPE_MAX_QUANTITY + 1)]).ok).toBe(false);
    const dup = parseRecipe(['1', '1'], ['1', '2']);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toContain('một lần');
  });

  it('giới hạn số dòng', () => {
    const ids = Array.from({ length: RECIPE_MAX_LINES + 1 }, (_, index) => String(index + 1));
    const quantities = ids.map(() => '1');
    expect(parseRecipe(ids, quantities).ok).toBe(false);
    expect(parseRecipe(ids.slice(0, RECIPE_MAX_LINES), quantities.slice(0, RECIPE_MAX_LINES)).ok).toBe(true);
  });
});

describe('gắn thông tin hiển thị cho công thức', () => {
  const catalog: MaterialOption[] = [
    { id: 1, name: 'Charm chuông', group: 'Charm bạc', unitCost: 35000, active: true },
    { id: 2, name: 'Đá đỏ', group: 'Đá - Hổ phách', unitCost: 10000, active: false },
  ];

  it('lấy tên, nhóm, đơn giá và trạng thái; bỏ nguyên liệu không có trong danh mục', () => {
    const lines = resolveRecipeLines(
      [
        { materialId: 1, quantity: 2 },
        { materialId: 2, quantity: 1 },
        { materialId: 99, quantity: 5 },
      ],
      catalog,
    );
    expect(lines).toEqual([
      { materialId: 1, quantity: 2, name: 'Charm chuông', group: 'Charm bạc', unitCost: 35000, active: true },
      { materialId: 2, quantity: 1, name: 'Đá đỏ', group: 'Đá - Hổ phách', unitCost: 10000, active: false },
    ]);
  });
});
