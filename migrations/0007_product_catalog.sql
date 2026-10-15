ALTER TABLE `products` ADD `compare_price` integer CHECK(`compare_price` is null or `compare_price` >= 0);--> statement-breakpoint
ALTER TABLE `products` ADD `group_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `cord_type` text DEFAULT '' NOT NULL;
