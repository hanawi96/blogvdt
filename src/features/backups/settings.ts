import { eq } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { backupSettings } from '../../lib/db/schema';

export const BACKUP_SETTING_KEYS = [
  'schedule_enabled',
  'schedule_hour_utc',
  'retention_count',
  'drive_enabled',
  /** Giá trị lưu ngày VN YYYY-MM-DD (tên key cũ giữ để khỏi migration). */
  'last_schedule_day_utc',
  /** Epoch ms khi bắt đầu restore; rỗng = không khóa. */
  'restore_lock',
] as const;

export type BackupSettingKey = (typeof BACKUP_SETTING_KEYS)[number];

export type BackupSettings = {
  scheduleEnabled: boolean;
  scheduleHourUtc: number;
  retentionCount: number;
  driveEnabled: boolean;
  /** Ngày VN YYYY-MM-DD lần lịch đã enqueue thành công. */
  lastScheduleDay: string;
};

const DEFAULTS: BackupSettings = {
  scheduleEnabled: false,
  scheduleHourUtc: 17,
  retentionCount: 14,
  driveEnabled: false,
  lastScheduleDay: '',
};

export async function getBackupSettings(db: AppDb): Promise<BackupSettings> {
  const rows = await db.select().from(backupSettings);
  const map = new Map(rows.map((row) => [row.key, row.value]));
  const hour = Number(map.get('schedule_hour_utc') ?? DEFAULTS.scheduleHourUtc);
  const retention = Number(map.get('retention_count') ?? DEFAULTS.retentionCount);
  return {
    scheduleEnabled: map.get('schedule_enabled') === '1',
    scheduleHourUtc: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULTS.scheduleHourUtc,
    retentionCount: Number.isInteger(retention) && retention >= 1 && retention <= 90 ? retention : DEFAULTS.retentionCount,
    driveEnabled: map.get('drive_enabled') === '1',
    lastScheduleDay: map.get('last_schedule_day_utc') ?? '',
  };
}

export async function setBackupSetting(db: AppDb, key: BackupSettingKey, value: string, now = Date.now()): Promise<void> {
  await db
    .insert(backupSettings)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({ target: backupSettings.key, set: { value, updatedAt: now } });
}

export async function saveBackupSettings(
  db: AppDb,
  input: { scheduleEnabled: boolean; scheduleHourUtc: number; retentionCount: number; driveEnabled: boolean },
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isInteger(input.scheduleHourUtc) || input.scheduleHourUtc < 0 || input.scheduleHourUtc > 23) {
    return { ok: false, error: 'Giờ lịch không hợp lệ.' };
  }
  if (!Number.isInteger(input.retentionCount) || input.retentionCount < 1 || input.retentionCount > 90) {
    return { ok: false, error: 'Số bản giữ lại phải từ 1 đến 90.' };
  }
  await Promise.all([
    setBackupSetting(db, 'schedule_enabled', input.scheduleEnabled ? '1' : '0', now),
    setBackupSetting(db, 'schedule_hour_utc', String(input.scheduleHourUtc), now),
    setBackupSetting(db, 'retention_count', String(input.retentionCount), now),
    setBackupSetting(db, 'drive_enabled', input.driveEnabled ? '1' : '0', now),
  ]);
  return { ok: true };
}

export async function markScheduleDay(db: AppDb, dayVn: string, now = Date.now()): Promise<void> {
  await setBackupSetting(db, 'last_schedule_day_utc', dayVn, now);
}

export async function readLastScheduleDay(db: AppDb): Promise<string> {
  const rows = await db.select().from(backupSettings).where(eq(backupSettings.key, 'last_schedule_day_utc')).limit(1);
  return rows[0]?.value ?? '';
}
