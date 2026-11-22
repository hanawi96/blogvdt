CREATE TABLE `backup_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`tables_json` text,
	`r2_key` text,
	`bytes` integer,
	`sha256` text,
	`drive_file_id` text,
	`drive_status` text NOT NULL DEFAULT 'skipped',
	`error` text,
	`created_by` integer REFERENCES `admin_users`(`id`) ON DELETE set null,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	`run_at` integer,
	`workflow_instance_id` text
);
--> statement-breakpoint
CREATE INDEX `backup_jobs_status_created_idx` ON `backup_jobs` (`status`, `created_at`);
--> statement-breakpoint
CREATE INDEX `backup_jobs_kind_status_idx` ON `backup_jobs` (`kind`, `status`, `created_at`);
--> statement-breakpoint
CREATE INDEX `backup_jobs_run_at_idx` ON `backup_jobs` (`run_at`);
--> statement-breakpoint
CREATE TABLE `backup_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `backup_settings` (`key`, `value`, `updated_at`) VALUES
	('schedule_enabled', '0', 0),
	('schedule_hour_utc', '17', 0),
	('retention_count', '14', 0),
	('drive_enabled', '0', 0),
	('last_schedule_day_utc', '', 0);
