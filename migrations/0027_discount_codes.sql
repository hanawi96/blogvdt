CREATE TABLE `discount_codes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`kind` text NOT NULL,
	`value` integer NOT NULL,
	`min_subtotal` integer NOT NULL DEFAULT 0,
	`usage_limit` integer,
	`used_count` integer NOT NULL DEFAULT 0,
	`starts_at` integer,
	`ends_at` integer,
	`active` integer NOT NULL DEFAULT 1,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `discount_codes_kind_check` CHECK(`kind` in ('percent', 'fixed')),
	CONSTRAINT `discount_codes_value_check` CHECK(`value` > 0),
	CONSTRAINT `discount_codes_min_check` CHECK(`min_subtotal` >= 0),
	CONSTRAINT `discount_codes_usage_limit_check` CHECK(`usage_limit` is null or `usage_limit` > 0),
	CONSTRAINT `discount_codes_used_check` CHECK(`used_count` >= 0),
	CONSTRAINT `discount_codes_active_check` CHECK(`active` in (0, 1)),
	CONSTRAINT `discount_codes_window_check` CHECK(`starts_at` is null or `ends_at` is null or `ends_at` > `starts_at`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discount_codes_code_unique` ON `discount_codes` (`code`);
--> statement-breakpoint
CREATE TABLE `discount_checks` (
	`ip_hash` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`hits` integer NOT NULL,
	CONSTRAINT `discount_checks_hits_check` CHECK(`hits` >= 0)
);
--> statement-breakpoint
ALTER TABLE `orders` ADD `subtotal` integer;
--> statement-breakpoint
ALTER TABLE `orders` ADD `discount_code` text;
--> statement-breakpoint
ALTER TABLE `orders` ADD `discount_amount` integer NOT NULL DEFAULT 0 CHECK(`discount_amount` >= 0);
--> statement-breakpoint
ALTER TABLE `orders` ADD `discount_restored` integer NOT NULL DEFAULT 0 CHECK(`discount_restored` in (0, 1));
