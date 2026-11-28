import {
  calendarRange,
  daysInMonth,
  formatOrderDateFilterLabel,
  vnLastNDaysRange,
  vnMonthRange,
  vnTodayParts,
  vnTodayRange,
  vnYesterdayRange,
  vnYmd,
} from '../../lib/datetime';

export type PnlPeriod = {
  from: string;
  to: string;
  /** YYYY-MM khi đang xem đúng một tháng lịch; null nếu khoảng tùy chỉnh. */
  monthKey: string | null;
  label: string;
  /** Epoch ms inclusive start = 00:00 VN ngày from. */
  start: number;
  /** Epoch ms exclusive end = 00:00 VN ngày sau to. */
  end: number;
};

export type PnlQuickPreset = {
  id: 'today' | 'yesterday' | '7' | '30' | '60' | '90';
  label: string;
  from: string;
  to: string;
};

/**
 * Preset lọc nhanh — cùng nguồn với trang đơn (vnToday / yesterday / last N).
 * Nút ngoài trang và dialog phải dùng đúng các khoảng này để số liệu khớp URL.
 */
export function pnlQuickPresets(now = Date.now()): PnlQuickPreset[] {
  const today = vnTodayRange(now);
  const yesterday = vnYesterdayRange(now);
  const last7 = vnLastNDaysRange(7, now)!;
  const last30 = vnLastNDaysRange(30, now)!;
  const last60 = vnLastNDaysRange(60, now)!;
  const last90 = vnLastNDaysRange(90, now)!;
  return [
    { id: 'today', label: 'Hôm nay', from: today.from, to: today.to },
    { id: 'yesterday', label: 'Hôm qua', from: yesterday.from, to: yesterday.to },
    { id: '7', label: '7 ngày gần nhất', from: last7.from, to: last7.to },
    { id: '30', label: '30 ngày gần nhất', from: last30.from, to: last30.to },
    { id: '60', label: '60 ngày gần nhất', from: last60.from, to: last60.to },
    { id: '90', label: '90 ngày gần nhất', from: last90.from, to: last90.to },
  ];
}

/** Nút chip ngoài trang — cùng khoảng với dialog (N ngày = gồm hôm nay). */
export function pnlQuickChipPresets(now = Date.now()): PnlQuickPreset[] {
  return pnlQuickPresets(now);
}

export function isPnlPresetActive(period: Pick<PnlPeriod, 'from' | 'to'>, preset: Pick<PnlQuickPreset, 'from' | 'to'>): boolean {
  return period.from === preset.from && period.to === preset.to;
}

/** Nhãn khoảng ngày hiển thị xác nhận (DD/MM hoặc DD/MM–DD/MM). */
export function pnlRangeCaption(from: string, to: string): string {
  const fmt = (value: string) => `${value.slice(8, 10)}/${value.slice(5, 7)}`;
  if (from === to) return fmt(from);
  if (from.slice(0, 7) === to.slice(0, 7)) return `${from.slice(8, 10)}–${fmt(to)}`;
  return `${fmt(from)}–${fmt(to)}`;
}

function monthKeyOf(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function parseMonthKey(value: string | null): { year: number; month: number } | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || month < 1 || month > 12) return null;
  if (daysInMonth(year, month) < 1) return null;
  return { year, month };
}

function monthKeyFromRange(from: string, to: string, now: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  const year = Number(from.slice(0, 4));
  const month = Number(from.slice(5, 7));
  if (!Number.isInteger(year) || month < 1 || month > 12) return null;
  const span = vnMonthRange(year, month, now);
  if (!span || span.from !== from || span.to !== to) return null;
  return monthKeyOf(year, month);
}

function periodOf(from: string, to: string, now: number): PnlPeriod | null {
  const bounds = calendarRange(from, to);
  if (bounds.invalid || bounds.start === null || bounds.end === null) return null;
  const monthKey = monthKeyFromRange(from, to, now);
  return {
    from,
    to,
    monthKey,
    label: formatOrderDateFilterLabel(from, to, now),
    start: bounds.start,
    end: bounds.end,
  };
}

/** Kỳ P&L: ?month=YYYY-MM hoặc ?from=&to= (YYYY-MM-DD). Mặc định tháng VN hiện tại. */
export function readPnlPeriod(params: URLSearchParams, now = Date.now()): PnlPeriod {
  const today = vnTodayParts(now);
  const monthParam = parseMonthKey(params.get('month'));
  if (monthParam) {
    const range = vnMonthRange(monthParam.year, monthParam.month, now);
    if (range) {
      const period = periodOf(range.from, range.to, now);
      if (period) return period;
    }
  }

  const fromParam = (params.get('from') ?? '').trim();
  const toParam = (params.get('to') ?? '').trim();
  if (fromParam || toParam) {
    const from = fromParam || toParam;
    const to = toParam || fromParam;
    const period = periodOf(from, to, now);
    if (period) return period;
  }

  const current = vnMonthRange(today.year, today.month, now);
  const from = current?.from ?? vnYmd(today);
  const to = current?.to ?? vnYmd(today);
  return (
    periodOf(from, to, now) ?? {
      from,
      to,
      monthKey: monthKeyOf(today.year, today.month),
      label: formatOrderDateFilterLabel(from, to, now),
      start: Date.parse(`${from}T00:00:00+07:00`),
      end: Date.parse(`${to}T00:00:00+07:00`) + 86_400_000,
    }
  );
}

export function pnlPeriodPath(base: string, period: Pick<PnlPeriod, 'monthKey' | 'from' | 'to'>): string {
  const query = new URLSearchParams();
  // Luôn dùng from/to để khớp 1:1 với preset/dialog và với truy vấn start/end.
  query.set('from', period.from);
  query.set('to', period.to);
  return `${base}?${query.toString()}`;
}

/** Các ngày YYYY-MM-DD từ from đến to (gồm hai đầu). Null nếu khoảng không hợp lệ / quá dài. */
export function periodDayKeys(from: string, to: string): string[] | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return null;
  const days: string[] = [];
  let cursor = from;
  for (let step = 0; step < 400; step += 1) {
    days.push(cursor);
    if (cursor === to) return days;
    const year = Number(cursor.slice(0, 4));
    const month = Number(cursor.slice(5, 7));
    const day = Number(cursor.slice(8, 10));
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    cursor = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
  }
  return null;
}

export function adjacentMonthKey(monthKey: string, delta: -1 | 1, now = Date.now()): string | null {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) return null;
  let year = parsed.year;
  let month = parsed.month + delta;
  if (month < 1) {
    year -= 1;
    month = 12;
  } else if (month > 12) {
    year += 1;
    month = 1;
  }
  const today = vnTodayParts(now);
  if (year > today.year || (year === today.year && month > today.month)) return null;
  if (year < 2020) return null;
  return monthKeyOf(year, month);
}
