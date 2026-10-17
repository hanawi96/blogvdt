CREATE TABLE `order_costs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`value` integer NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `order_costs_kind_check` CHECK(`kind` in ('fixed', 'percent')),
	CONSTRAINT `order_costs_value_check` CHECK(`value` >= 0),
	CONSTRAINT `order_costs_active_check` CHECK(`active` in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_costs_name_unique` ON `order_costs` (lower(`name`));
--> statement-breakpoint
ALTER TABLE `orders` ADD `cost_goods` integer;
--> statement-breakpoint
ALTER TABLE `orders` ADD `cost_extra` integer;
