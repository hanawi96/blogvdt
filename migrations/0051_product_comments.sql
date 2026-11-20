CREATE TABLE `product_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`parent_id` integer,
	`author_name` text NOT NULL,
	`author_kind` text DEFAULT 'guest' NOT NULL,
	`body` text NOT NULL,
	`r2_key` text,
	`image_width` integer,
	`image_height` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`ip_hash` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `product_comments`(`id`) ON UPDATE no action ON DELETE cascade,
	CHECK (`author_kind` IN ('guest', 'shop')),
	CHECK (`status` IN ('pending', 'approved', 'hidden')),
	CHECK (length(trim(`author_name`)) > 0),
	CHECK (length(trim(`body`)) > 0)
);
--> statement-breakpoint
CREATE INDEX `product_comments_product_public_idx` ON `product_comments` (`product_id`, `status`, `parent_id`, `id`);
--> statement-breakpoint
CREATE INDEX `product_comments_admin_list_idx` ON `product_comments` (`status`, `created_at`, `id`);
--> statement-breakpoint
CREATE INDEX `product_comments_rate_idx` ON `product_comments` (`ip_hash`, `created_at`);
