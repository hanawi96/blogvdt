CREATE TABLE `ad_spend` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`day` text NOT NULL,
	`amount` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `ad_spend_kind_check` CHECK(`kind` in ('rate', 'day')),
	CONSTRAINT `ad_spend_amount_check` CHECK(`amount` >= 0),
	CONSTRAINT `ad_spend_day_check` CHECK(`day` glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ad_spend_kind_day_unique` ON `ad_spend` (`kind`, `day`);
