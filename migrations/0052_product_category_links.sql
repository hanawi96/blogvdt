CREATE TABLE `product_category_links` (
	`product_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	PRIMARY KEY(`product_id`, `category_id`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `product_categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `product_category_links_category_idx` ON `product_category_links` (`category_id`);
--> statement-breakpoint
INSERT INTO `product_category_links` (`product_id`, `category_id`)
SELECT `id`, `category_id` FROM `products` WHERE `category_id` IS NOT NULL;
