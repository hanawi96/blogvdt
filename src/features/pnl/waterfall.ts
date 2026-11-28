/** Cộng số kỳ đã aggregate sẵn — không chạm DB. */

export type PnlPeriodTotals = {
  /** Đơn hợp lệ (không hủy, không gửi bù). */
  orders: number;
  /** Đơn hợp lệ đã có đủ cost_goods + cost_extra. */
  costedOrders: number;
  /** Tổng total_price đơn hợp lệ. */
  revenue: number;
  /** Tổng total_price đơn đã có chi phí — nền của lãi gộp. */
  costedRevenue: number;
  /** Tổng vốn hàng trên đơn đã có chi phí. */
  costGoods: number;
  /** Tổng chi phí đơn (hộp…) trên đơn đã có chi phí. */
  costExtra: number;
  /** Tổng vốn ship trên đơn đã có chi phí. */
  shippingCost: number;
  /** Tổng giảm giá đơn hợp lệ (đã phản ánh trong revenue; chỉ để xem). */
  discountAmount: number;
  /** Quảng cáo kỳ — 0 nếu chưa gắn. */
  adSpend: number;
  /** Ngân sách tiền công kỳ — chỉ đối chiếu, không trừ lãi. */
  laborBudget: number;
};

export type PnlWaterfall = {
  orders: number;
  costedOrders: number;
  revenue: number;
  costedRevenue: number;
  costGoods: number;
  costExtra: number;
  shippingCost: number;
  discountAmount: number;
  /** costedRevenue − costGoods − costExtra − shippingCost (khớp tổng orderProfit). */
  grossProfit: number;
  adSpend: number;
  /** grossProfit − adSpend. */
  profitAfterAds: number;
  laborBudget: number;
  /** Doanh thu TB / đơn hợp lệ; null nếu chưa có đơn. */
  aov: number | null;
  /** grossProfit / costedRevenue (% làm tròn); null nếu chưa có doanh thu có vốn. */
  grossMarginPercent: number | null;
};

function average(total: number, count: number): number | null {
  if (count <= 0) return null;
  return Math.round(total / count);
}

function marginPercent(profit: number, base: number): number | null {
  if (base <= 0) return null;
  return Math.round((profit / base) * 100);
}

export function buildPnlWaterfall(input: PnlPeriodTotals): PnlWaterfall {
  const grossProfit = input.costedRevenue - input.costGoods - input.costExtra - input.shippingCost;
  const adSpend = Math.max(0, input.adSpend);
  const laborBudget = Math.max(0, input.laborBudget);
  return {
    orders: input.orders,
    costedOrders: input.costedOrders,
    revenue: input.revenue,
    costedRevenue: input.costedRevenue,
    costGoods: input.costGoods,
    costExtra: input.costExtra,
    shippingCost: input.shippingCost,
    discountAmount: input.discountAmount,
    grossProfit,
    adSpend,
    profitAfterAds: grossProfit - adSpend,
    laborBudget,
    aov: average(input.revenue, input.orders),
    grossMarginPercent: marginPercent(grossProfit, input.costedRevenue),
  };
}

/** Cột waterfall: total/result neo từ 0; cost là cột “treo” giảm theo mức chạy. */
export type PnlWaterfallStep = {
  id: string;
  label: string;
  shortLabel: string;
  kind: 'total' | 'cost' | 'result';
  /** Giá trị hiển thị (với cost là số dương bị trừ). */
  amount: number;
  low: number;
  high: number;
};

/**
 * Bậc waterfall từ doanh thu có vốn → lãi sau ads.
 * Mốc lãi lấy từ mức chạy (sau khi trừ từng khoản) để luôn khớp cột trước đó.
 * Không gồm ngân sách tiền công (đối chiếu, không trừ).
 */
export function buildPnlWaterfallSteps(w: Pick<PnlWaterfall, 'costedRevenue' | 'costGoods' | 'costExtra' | 'shippingCost' | 'grossProfit' | 'adSpend' | 'profitAfterAds'>): PnlWaterfallStep[] {
  const steps: PnlWaterfallStep[] = [];
  let level = w.costedRevenue;

  const pushTotal = (id: string, label: string, shortLabel: string, amount: number, kind: 'total' | 'result') => {
    steps.push({
      id,
      label,
      shortLabel,
      kind,
      amount,
      low: Math.min(0, amount),
      high: Math.max(0, amount),
    });
  };

  const pushCost = (id: string, label: string, shortLabel: string, amount: number) => {
    const cost = Math.max(0, amount);
    const before = level;
    level -= cost;
    steps.push({
      id,
      label,
      shortLabel,
      kind: 'cost',
      amount: cost,
      low: Math.min(before, level),
      high: Math.max(before, level),
    });
  };

  pushTotal('costedRevenue', 'Doanh thu có vốn', 'DT có vốn', w.costedRevenue, 'total');
  pushCost('costGoods', 'Vốn hàng', 'Vốn hàng', w.costGoods);
  pushCost('costExtra', 'Chi phí đơn', 'Phí đơn', w.costExtra);
  pushCost('shippingCost', 'Vốn ship', 'Ship', w.shippingCost);
  // Dùng mức chạy — trùng w.grossProfit khi input đến từ buildPnlWaterfall.
  pushTotal('grossProfit', 'Lãi gộp', 'Lãi gộp', level, 'result');
  pushCost('adSpend', 'Quảng cáo', 'Ads', w.adSpend);
  pushTotal('profitAfterAds', 'Lãi sau quảng cáo', 'Sau ads', level, 'result');
  return steps;
}

/** Kiểm tra KPI/bảng/cột biểu đồ cùng một nguồn số. */
export function pnlWaterfallIntegrity(w: PnlWaterfall): { ok: true } | { ok: false; error: string } {
  const gross = w.costedRevenue - w.costGoods - w.costExtra - w.shippingCost;
  if (gross !== w.grossProfit) return { ok: false, error: `grossProfit lệch: field=${w.grossProfit} công thức=${gross}` };
  const afterAds = w.grossProfit - w.adSpend;
  if (afterAds !== w.profitAfterAds) return { ok: false, error: `profitAfterAds lệch: field=${w.profitAfterAds} công thức=${afterAds}` };
  const steps = buildPnlWaterfallSteps(w);
  const byId = new Map(steps.map((step) => [step.id, step]));
  const expect: Array<[string, number]> = [
    ['costedRevenue', w.costedRevenue],
    ['costGoods', w.costGoods],
    ['costExtra', w.costExtra],
    ['shippingCost', w.shippingCost],
    ['grossProfit', w.grossProfit],
    ['adSpend', w.adSpend],
    ['profitAfterAds', w.profitAfterAds],
  ];
  for (const [id, amount] of expect) {
    const step = byId.get(id);
    if (!step) return { ok: false, error: `thiếu bước ${id}` };
    if (step.amount !== amount) return { ok: false, error: `bước ${id}=${step.amount} ≠ ${amount}` };
  }
  return { ok: true };
}

export function waterfallValueDomain(steps: readonly PnlWaterfallStep[]): { min: number; max: number } {
  if (steps.length === 0) return { min: 0, max: 1 };
  let min = 0;
  let max = 0;
  for (const step of steps) {
    min = Math.min(min, step.low);
    max = Math.max(max, step.high);
  }
  if (min === max) return { min: Math.min(0, min), max: Math.max(1, max) };
  // Chừa đầu trên ~22% để nhãn số không dính lưới / mép biểu đồ.
  const padTop = Math.max(1, Math.round((max - min) * 0.22));
  const padBottom = min < 0 ? Math.max(1, Math.round((max - min) * 0.1)) : 0;
  return { min: min - padBottom, max: max + padTop };
}

/** Bỏ cột chi phí = 0 để biểu đồ gọn, tránh vạch mỏng và −0. */
export function visibleWaterfallSteps(steps: readonly PnlWaterfallStep[]): PnlWaterfallStep[] {
  return steps.filter((step) => step.kind !== 'cost' || step.amount > 0);
}

/** Nhãn trục Y gọn cho biểu đồ tiền. */
export function formatWaterfallAxis(value: number): string {
  const sign = value < 0 ? '−' : '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const tr = abs / 1_000_000;
    return `${sign}${Number.isInteger(tr) ? tr : tr.toFixed(1)}tr`;
  }
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)}k`;
  return `${sign}${Math.round(abs)}`;
}
