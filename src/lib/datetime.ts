export function calendarRange(from: string, to: string): { start: number | null; end: number | null; invalid: boolean } {
  const start = vnDayStart(from);
  const endDay = vnDayStart(to);
  if ((from !== '' && start === null) || (to !== '' && endDay === null)) return { start: null, end: null, invalid: true };
  if (start !== null && endDay !== null && endDay < start) return { start, end: null, invalid: true };
  return { start, end: endDay === null ? null : endDay + 86_400_000, invalid: false };
}

function vnDayStart(value: string): number | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00+07:00`);
  return Number.isFinite(time) ? time : null;
}

const VN_TZ = 'Asia/Ho_Chi_Minh';

export type VnDayParts = { year: number; month: number; day: number };

/** Ngày hiện tại theo lịch Việt Nam (không theo timezone máy client). */
export function vnTodayParts(now = Date.now()): VnDayParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: VN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(now));
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  return { year, month, day };
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Cộng/trừ ngày trên lịch Gregorian (dùng cho mốc VN đã tách sẵn). */
export function vnAddDays(parts: VnDayParts, offsetDays: number): VnDayParts {
  const utc = Date.UTC(parts.year, parts.month - 1, parts.day + offsetDays);
  const date = new Date(utc);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export function vnYmd(parts: VnDayParts): string {
  return ymd(parts.year, parts.month, parts.day);
}

/** Mốc 00:00 giờ VN của ngày hôm nay (epoch ms). */
export function vnTodayStartMs(now = Date.now()): number {
  return Date.parse(`${vnYmd(vnTodayParts(now))}T00:00:00+07:00`);
}

/** Một ngày: hôm qua theo lịch VN. */
export function vnYesterdayRange(now = Date.now()): { from: string; to: string } {
  const day = vnYmd(vnAddDays(vnTodayParts(now), -1));
  return { from: day, to: day };
}

/**
 * N ngày gần nhất (gồm hôm nay): from = today-(n-1), to = today.
 * Ví dụ n=7 → 7 ngày qua, n=30 → 30 ngày qua.
 */
export function vnLastNDaysRange(n: number, now = Date.now()): { from: string; to: string } | null {
  if (!Number.isInteger(n) || n < 1) return null;
  const today = vnTodayParts(now);
  const from = vnAddDays(today, -(n - 1));
  return { from: vnYmd(from), to: vnYmd(today) };
}

/** Số ngày trong tháng (1–12), lịch Gregorian. */
export function daysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) return 0;
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Khoảng lọc một tháng theo giờ VN: từ ngày 1 đến hết tháng,
 * hoặc đến hôm nay nếu là tháng hiện tại.
 */
export function vnMonthRange(year: number, month: number, now = Date.now()): { from: string; to: string } | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  const last = daysInMonth(year, month);
  if (last < 1) return null;
  const today = vnTodayParts(now);
  if (year > today.year || (year === today.year && month > today.month)) return null;
  const from = ymd(year, month, 1);
  const to =
    year === today.year && month === today.month
      ? ymd(today.year, today.month, today.day)
      : ymd(year, month, last);
  return { from, to };
}

function parseYmd(value: string): VnDayParts | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

function formatDm(value: string): string {
  const parts = parseYmd(value);
  if (!parts) return value;
  return `${pad2(parts.day)}/${pad2(parts.month)}`;
}

/** Nhãn nút lọc ngày trên list đơn. */
export function formatOrderDateFilterLabel(from: string, to: string, now = Date.now()): string {
  if (!from && !to) return 'Chọn ngày';
  const start = from || to;
  const end = to || from;
  if (from && to) {
    const yesterday = vnYesterdayRange(now);
    if (from === yesterday.from && to === yesterday.to) return 'Hôm qua';
    const last7 = vnLastNDaysRange(7, now);
    if (last7 && from === last7.from && to === last7.to) return '7 ngày qua';
    const last30 = vnLastNDaysRange(30, now);
    if (last30 && from === last30.from && to === last30.to) return '30 ngày qua';
    const startParts = parseYmd(from);
    if (startParts) {
      const monthRange = vnMonthRange(startParts.year, startParts.month, now);
      if (monthRange && from === monthRange.from && to === monthRange.to) {
        return `Tháng ${startParts.month}`;
      }
    }
    if (from === to) return formatDm(from);
    const a = parseYmd(from);
    const b = parseYmd(to);
    if (a && b && a.year === b.year && a.month === b.month) {
      return `${pad2(a.day)}–${formatDm(to)}`;
    }
    return `${formatDm(from)}–${formatDm(to)}`;
  }
  return formatDm(start || end);
}

export function formatDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

/** Giờ:phút VN — dạng cố định `HH:mm` cho indicator autosave. */
export function formatTimeHm(timestamp: number): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(timestamp));
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
}

/** Giờ:phút:giây VN — `HH:mm:ss` cho danh sách đơn. */
export function formatTimeHms(timestamp: number): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(timestamp));
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  const second = parts.find((part) => part.type === 'second')?.value ?? '00';
  return `${hour}:${minute}:${second}`;
}

/** Ngày ngắn VN — `dd/MM/yyyy`. */
export function formatDateShort(timestamp: number): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(timestamp));
}
