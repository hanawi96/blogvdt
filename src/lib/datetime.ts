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

export function formatDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}
