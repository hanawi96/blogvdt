import { vnAddDays, vnTodayParts, vnYmd, type VnDayParts } from '../../lib/datetime';

export const OVERVIEW_DAYS = 7;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Giữ helper kỳ cũ cho test; KPI overview cố định 7 ngày. */
export const DASHBOARD_PERIODS = [7, 30, 90] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];
export const DEFAULT_PERIOD: DashboardPeriod = 7;

/** Kỳ lọc biểu đồ xu hướng trên tổng quan. */
export const CHART_RANGES = ['today', '7', '30'] as const;
export type ChartRange = (typeof CHART_RANGES)[number];
export const DEFAULT_CHART_RANGE: ChartRange = '7';
export const CHART_RANGE_OPTIONS: ReadonlyArray<{ value: ChartRange; label: string }> = [
  { value: 'today', label: 'Hôm nay' },
  { value: '7', label: '7 ngày' },
  { value: '30', label: '30 ngày' },
];

export function readPeriod(value: string | null): DashboardPeriod {
  const days = Number(value);
  return DASHBOARD_PERIODS.find((period) => period === days) ?? DEFAULT_PERIOD;
}

export function readChartRange(value: string | null): ChartRange {
  return CHART_RANGES.find((range) => range === value) ?? DEFAULT_CHART_RANGE;
}

export function periodRange(days: DashboardPeriod, now: number): { start: number; previousStart: number } {
  const start = now - days * DAY_MS;
  return { start, previousStart: start - days * DAY_MS };
}

function dayList(from: VnDayParts, count: number): string[] {
  return Array.from({ length: count }, (_, index) => vnYmd(vnAddDays(from, index)));
}

function vnMidnight(parts: VnDayParts): number {
  return Date.parse(`${vnYmd(parts)}T00:00:00+07:00`);
}

const HOURS_24 = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'));

/** N ngày lịch VN gần nhất (gồm hôm nay) vs N ngày liền trước. */
export function dayWindows(
  days: 7 | 30,
  now = Date.now(),
): {
  currentStart: number;
  previousStart: number;
  currentDays: string[];
  previousDays: string[];
} {
  const today = vnTodayParts(now);
  const currentFrom = vnAddDays(today, -(days - 1));
  const previousTo = vnAddDays(currentFrom, -1);
  const previousFrom = vnAddDays(previousTo, -(days - 1));
  return {
    currentStart: vnMidnight(currentFrom),
    previousStart: vnMidnight(previousFrom),
    currentDays: dayList(currentFrom, days),
    previousDays: dayList(previousFrom, days),
  };
}

/** 7 ngày lịch VN gần nhất — dùng cho KPI/top danh sách. */
export function overviewWindows(now = Date.now()) {
  return dayWindows(OVERVIEW_DAYS, now);
}

/** Hôm nay theo giờ VN vs hôm qua (24 mốc 00–23). */
export function todayHourWindows(now = Date.now()): {
  currentStart: number;
  previousStart: number;
  currentDay: string;
  previousDay: string;
  hours: string[];
  labels: string[];
} {
  const today = vnTodayParts(now);
  const yesterday = vnAddDays(today, -1);
  return {
    currentStart: vnMidnight(today),
    previousStart: vnMidnight(yesterday),
    currentDay: vnYmd(today),
    previousDay: vnYmd(yesterday),
    hours: HOURS_24,
    labels: HOURS_24.map((hour) => `${Number(hour)}h`),
  };
}

export function chartLegend(range: ChartRange): { current: string; previous: string } {
  if (range === 'today') return { current: 'Hôm nay', previous: 'Hôm qua' };
  if (range === '7') return { current: '7 ngày gần nhất', previous: '7 ngày trước đó' };
  return { current: '30 ngày gần nhất', previous: '30 ngày trước đó' };
}

export type ChartSeries = {
  labels: string[];
  orders: { current: number[]; previous: number[] };
  revenue: { current: number[]; previous: number[] };
  /** Lãi ròng theo kỳ — chỉ đơn đã có đủ chi phí (cùng công thức KPI). */
  profit: { current: number[]; previous: number[] };
  /** Số sản phẩm đã bán (order_items + đơn legacy), cùng phạm vi KPI sold. */
  sold: { current: number[]; previous: number[] };
  legend: { current: string; previous: string };
  grain: 'hour' | 'day';
};

export type DashboardRankItem = {
  name: string;
  orders: number;
  revenue: number;
};

export type DashboardTopProduct = {
  productId: number;
  name: string;
  sold: number;
  imageUrl: string | null;
  imageAlt: string;
};

/** Top tỉnh / nguồn / sản phẩm theo cùng kỳ lọc biểu đồ. */
export type DashboardBreakdown = {
  provinces: DashboardRankItem[];
  sources: DashboardRankItem[];
  topProducts: DashboardTopProduct[];
  /** Top SP bán ít nhất trong kỳ (sold > 0), cùng công thức với topProducts. */
  leastProducts: DashboardTopProduct[];
};

export function chartEmptyHint(range: ChartRange): string {
  if (range === 'today') return 'Chưa có đơn hôm nay.';
  if (range === '7') return 'Chưa có đơn trong 7 ngày gần nhất.';
  return 'Chưa có đơn trong 30 ngày gần nhất.';
}

export function kpiTitle(range: ChartRange): string {
  if (range === 'today') return 'Chỉ số hôm nay';
  if (range === '7') return 'Chỉ số 7 ngày gần nhất';
  return 'Chỉ số 30 ngày gần nhất';
}

export type DashboardKpi = {
  orders: number;
  revenue: number;
  profit: number;
  /** Tổng số lượng SP đã bán (dòng đơn + đơn legacy), cùng phạm vi KPI. */
  sold: number;
  costedOrders: number;
  deltas: {
    orders: { text: string; tone: DeltaTone };
    revenue: { text: string; tone: DeltaTone };
    profit: { text: string; tone: DeltaTone };
    sold: { text: string; tone: DeltaTone };
  };
};

export function dayChartLabels(days: readonly string[]): string[] {
  return days.map((day) => `${day.slice(8, 10)}/${day.slice(5, 7)}`);
}

/** Điền 0 cho khóa thiếu; giữ đúng thứ tự `keys`. */
export function fillDailySeries(
  keys: readonly string[],
  rows: ReadonlyArray<{ day: string; value: number }>,
): number[] {
  const map = new Map(rows.map((row) => [row.day, row.value]));
  return keys.map((key) => map.get(key) ?? 0);
}

export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 100);
}

export function averageValue(value: number, orders: number): number {
  return orders > 0 ? Math.round(value / orders) : 0;
}

export function cancelRate(cancelled: number, orders: number): number {
  const total = cancelled + orders;
  return total > 0 ? Math.round((cancelled / total) * 100) : 0;
}

export type DeltaTone = 'good' | 'bad' | 'flat';

export function describeDelta(change: number | null, invert = false): { text: string; tone: DeltaTone } {
  if (change === null) return { text: 'Kỳ trước chưa có', tone: 'flat' };
  if (change === 0) return { text: 'Không đổi so với kỳ trước', tone: 'flat' };
  const up = change > 0;
  const text = `${up ? '+' : '−'}${Math.abs(change)}% so với kỳ trước`;
  return { text, tone: up !== invert ? 'good' : 'bad' };
}

function aggregateSoldProducts(
  parts: ReadonlyArray<ReadonlyArray<{ productId: number | null; sold: number }>>,
): { productId: number; sold: number }[] {
  const totals = new Map<number, number>();
  for (const part of parts) {
    for (const row of part) {
      if (row.productId === null || row.sold <= 0) continue;
      totals.set(row.productId, (totals.get(row.productId) ?? 0) + row.sold);
    }
  }
  return [...totals.entries()].map(([productId, sold]) => ({ productId, sold }));
}

export function mergeTopProducts(
  parts: ReadonlyArray<ReadonlyArray<{ productId: number | null; sold: number }>>,
  limit: number,
): { productId: number; sold: number }[] {
  return aggregateSoldProducts(parts)
    .sort((a, b) => b.sold - a.sold || a.productId - b.productId)
    .slice(0, limit);
}

/** Top SP bán ít nhất (sold > 0), hòa thì id nhỏ trước. */
export function mergeLeastProducts(
  parts: ReadonlyArray<ReadonlyArray<{ productId: number | null; sold: number }>>,
  limit: number,
): { productId: number; sold: number }[] {
  return aggregateSoldProducts(parts)
    .sort((a, b) => a.sold - b.sold || a.productId - b.productId)
    .slice(0, limit);
}
