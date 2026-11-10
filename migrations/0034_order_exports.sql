-- Làm sạch schema export cũ (nếu có) rồi tạo lại cho SPX history.
DROP TABLE IF EXISTS `order_export_items`;
--> statement-breakpoint
DROP TABLE IF EXISTS `order_exports`;
--> statement-breakpoint
CREATE TABLE `order_exports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`filename` text NOT NULL,
	`r2_key` text NOT NULL,
	`order_count` integer NOT NULL,
	`skipped_count` integer NOT NULL DEFAULT 0,
	`downloaded_at` integer,
	`created_by` integer REFERENCES `admin_users`(`id`) ON DELETE set null,
	`created_at` integer NOT NULL,
	CHECK (`order_count` >= 0),
	CHECK (`skipped_count` >= 0)
);
--> statement-breakpoint
CREATE INDEX `order_exports_created_at_idx` ON `order_exports` (`created_at`,`id`);
--> statement-breakpoint
CREATE TABLE `order_export_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`export_id` integer NOT NULL REFERENCES `order_exports`(`id`) ON DELETE cascade,
	`order_id` integer NOT NULL REFERENCES `orders`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `order_export_items_export_idx` ON `order_export_items` (`export_id`);
--> statement-breakpoint
CREATE INDEX `order_export_items_order_idx` ON `order_export_items` (`order_id`);
