import { describe, expect, it } from 'vitest';
import { describeDailySchedule, shouldEnqueueDailySchedule } from './schedule';
import { vnDateTimeToUtcMs, vnHourToUtcHour } from './time';

describe('shouldEnqueueDailySchedule', () => {
  const hourVn = 22;
  const scheduleHourUtc = vnHourToUtcHour(hourVn);
  const dayVn = '2026-11-22';
  const dueAt = vnDateTimeToUtcMs(dayVn, hourVn, 0)!;

  it('tắt lịch → false', () => {
    expect(
      shouldEnqueueDailySchedule({
        scheduleEnabled: false,
        scheduleHourUtc,
        lastScheduleDay: '',
        hasActiveJob: false,
        now: dueAt,
      }),
    ).toBe(false);
  });

  it('trước giờ VN hôm nay → false', () => {
    expect(
      shouldEnqueueDailySchedule({
        scheduleEnabled: true,
        scheduleHourUtc,
        lastScheduleDay: '',
        hasActiveJob: false,
        now: dueAt - 60_000,
      }),
    ).toBe(false);
  });

  it('đúng/sau giờ VN chưa chạy → true', () => {
    expect(
      shouldEnqueueDailySchedule({
        scheduleEnabled: true,
        scheduleHourUtc,
        lastScheduleDay: '',
        hasActiveJob: false,
        now: dueAt,
      }),
    ).toBe(true);
    // +30 phút vẫn cùng ngày VN (22:00); +3 giờ sẽ sang ngày mới.
    expect(
      shouldEnqueueDailySchedule({
        scheduleEnabled: true,
        scheduleHourUtc,
        lastScheduleDay: '',
        hasActiveJob: false,
        now: dueAt + 30 * 60 * 1000,
      }),
    ).toBe(true);
  });

  it('đã mark ngày VN → false', () => {
    expect(
      shouldEnqueueDailySchedule({
        scheduleEnabled: true,
        scheduleHourUtc,
        lastScheduleDay: dayVn,
        hasActiveJob: false,
        now: dueAt + 60_000,
      }),
    ).toBe(false);
  });

  it('đang active → false (không mark; catch-up sau)', () => {
    expect(
      shouldEnqueueDailySchedule({
        scheduleEnabled: true,
        scheduleHourUtc,
        lastScheduleDay: '',
        hasActiveJob: true,
        now: dueAt + 60_000,
      }),
    ).toBe(false);
  });
});

describe('describeDailySchedule', () => {
  it('báo đã chạy hôm nay và nextAt ngày sau', () => {
    const hourVn = 22;
    const scheduleHourUtc = vnHourToUtcHour(hourVn);
    const dayVn = '2026-11-22';
    const dueAt = vnDateTimeToUtcMs(dayVn, hourVn, 0)!;
    const info = describeDailySchedule({
      scheduleEnabled: true,
      scheduleHourUtc,
      lastScheduleDay: dayVn,
      now: dueAt + 60_000,
    });
    expect(info.ranToday).toBe(true);
    expect(info.hourVn).toBe(22);
    expect(info.nextAt).toBe(vnDateTimeToUtcMs('2026-11-23', 22, 0));
  });
});
