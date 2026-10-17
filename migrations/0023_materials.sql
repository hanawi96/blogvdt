CREATE TABLE `materials` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`group_name` text NOT NULL,
	`unit_cost` integer NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `materials_unit_cost_check` CHECK(`unit_cost` >= 0),
	CONSTRAINT `materials_active_check` CHECK(`active` in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `materials_code_unique` ON `materials` (`code`);
--> statement-breakpoint
CREATE INDEX `materials_group_idx` ON `materials` (`group_name`);
--> statement-breakpoint
CREATE TABLE `product_materials` (
	`product_id` integer NOT NULL,
	`material_id` integer NOT NULL,
	`quantity` integer NOT NULL,
	PRIMARY KEY(`product_id`, `material_id`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `product_materials_quantity_check` CHECK(`quantity` > 0)
);
--> statement-breakpoint
CREATE INDEX `product_materials_material_idx` ON `product_materials` (`material_id`);
