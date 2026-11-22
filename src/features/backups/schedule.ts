import { utcHourToVnHour, vnDateTimeToUtcMs, vnDayKey } from './time';

export type DailyScheduleDecisionInput = {
  scheduleEnabled: boolean;
  /** Giờ UTC đã lưu (UI nhập giờ VN rồi đổi sang UTC). */
  scheduleHourUtc: number;
  /** Ngày VN YYYY-MM-DD lần lịch gần nhất đã enqueue thành công. */
  lastScheduleDay: string;
  hasActiveJob: boolean;
  now?: number;
};

/**
 * Có nên tạo job Full lịch hôm nay (giờ VN) không.
 * Catch-up: sau mốc giờ VN, nếu chưa mark ngày VN và không bận → true.
 * Đang active → false (không mark ngày; tick giờ sau thử lại).
 */
export function shouldEnqueueDailySchedule(input: DailyScheduleDecisionInput): boolean {
  if (!input.scheduleEnabled) return false;
  if (input.hasActiveJob) return false;
  const now = input.now ?? Date.now();
  const dayVn = vnDayKey(now);
  if (input.lastScheduleDay === dayVn) return false;
  if (!Number.isInteger(input.scheduleHourUtc) || input.scheduleHourUtc < 0 || input.scheduleHourUtc > 23) {
    return false;
  }
  const hourVn = utcHourToVnHour(input.scheduleHourUtc);
  const dueAt = vnDateTimeToUtcMs(dayVn, hourVn, 0);
  if (dueAt == null) return false;
  return now >= dueAt;
}

export type ScheduleStatusInfo = {
  hourVn: number;
  todayVn: string;
  ranToday: boolean;
  /** Epoch ms mốc giờ hôm nay (VN); null nếu giờ không hợp lệ. */
  dueAtToday: number | null;
  /** Epoch ms mốc giờ ngày VN tiếp theo nếu hôm nay đã chạy hoặc chưa tới giờ. */
  nextAt: number | null;
};

export function describeDailySchedule(input: {
  scheduleEnabled: boolean;
  scheduleHourUtc: number;
  lastScheduleDay: string;
  now?: number;
}): ScheduleStatusInfo {
  const now = input.now ?? Date.now();
  const todayVn = vnDayKey(now);
  const hourVn = utcHourToVnHour(input.scheduleHourUtc);
  const dueAtToday = vnDateTimeToUtcMs(todayVn, hourVn, 0);
  const ranToday = input.lastScheduleDay === todayVn;

  let nextAt: number | null = null;
  if (dueAtToday != null) {
    if (!ranToday && now < dueAtToday) {
      nextAt = dueAtToday;
    } else if (!ranToday && now >= dueAtToday) {
      nextAt = dueAtToday; // đến hạn / đang chờ catch-up
    } else {
      // Đã chạy hôm nay → mốc cùng giờ ngày VN kế.
      const tomorrowMs = dueAtToday + 24 * 60 * 60 * 1000;
      const tomorrowVn = vnDayKey(tomorrowMs);
      nextAt = vnDateTimeToUtcMs(tomorrowVn, hourVn, 0);
    }
  }

  return { hourVn, todayVn, ranToday, dueAtToday, nextAt };
}
