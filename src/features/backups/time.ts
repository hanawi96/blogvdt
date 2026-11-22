/** Việt Nam cố định UTC+7, không DST. */

export const VN_OFFSET_HOURS = 7;

export const HOUR_OPTIONS_VN = Array.from({ length: 24 }, (_, hour) => {
  const label =
    hour === 0
      ? '00:00 — Nửa đêm'
      : hour === 6
        ? '06:00 — Sáng sớm'
        : hour === 12
          ? '12:00 — Trưa'
          : hour === 18
            ? '18:00 — Chiều tối'
            : hour === 22
              ? '22:00 — Tối'
              : `${String(hour).padStart(2, '0')}:00`;
  return { hour, label };
});

export const MINUTE_OPTIONS = [0, 15, 30, 45] as const;

export function utcHourToVnHour(utcHour: number): number {
  return (((utcHour % 24) + VN_OFFSET_HOURS) % 24 + 24) % 24;
}

export function vnHourToUtcHour(vnHour: number): number {
  return (((vnHour % 24) - VN_OFFSET_HOURS) % 24 + 24) % 24;
}

/** Chuyển ngày + giờ phút VN → epoch ms UTC. `date` dạng YYYY-MM-DD. */
export function vnDateTimeToUtcMs(date: string, hour: number, minute: number): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!match) return null;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day, hour - VN_OFFSET_HOURS, minute, 0, 0);
  return Number.isFinite(ms) ? ms : null;
}

/** Ngày lịch Việt Nam dạng YYYY-MM-DD (UTC+7 cố định). */
export function formatVnDateInput(ms = Date.now()): string {
  const shifted = new Date(ms + VN_OFFSET_HOURS * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

/** Alias rõ nghĩa cho dedup lịch backup theo ngày VN. */
export function vnDayKey(ms = Date.now()): string {
  return formatVnDateInput(ms);
}

export function formatVnHourMinute(ms = Date.now()): { hour: number; minute: number } {
  const shifted = new Date(ms + VN_OFFSET_HOURS * 60 * 60 * 1000);
  return { hour: shifted.getUTCHours(), minute: shifted.getUTCMinutes() };
}
