CREATE TABLE `invoice_exports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`filename` text NOT NULL,
	`r2_key` text NOT NULL,
	`order_count` integer NOT NULL,
	`downloaded_at` integer,
	`created_by` integer REFERENCES `admin_users`(`id`) ON DELETE set null,
	`created_at` integer NOT NULL,
	CHECK (`order_count` >= 0)
);
--> statement-breakpoint
CREATE INDEX `invoice_exports_created_at_idx` ON `invoice_exports` (`created_at`,`id`);
--> statement-breakpoint
CREATE TABLE `invoice_export_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`export_id` integer NOT NULL REFERENCES `invoice_exports`(`id`) ON DELETE cascade,
	`order_id` integer NOT NULL REFERENCES `orders`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invoice_export_items_export_idx` ON `invoice_export_items` (`export_id`);
--> statement-breakpoint
CREATE INDEX `invoice_export_items_order_idx` ON `invoice_export_items` (`order_id`);
