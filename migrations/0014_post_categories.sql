CREATE TABLE `post_categories` (
	`post_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	PRIMARY KEY(`post_id`, `category_id`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `post_categories_category_idx` ON `post_categories` (`category_id`);
--> statement-breakpoint
INSERT INTO `post_categories` (`post_id`, `category_id`)
SELECT `id`, `category_id` FROM `posts` WHERE `category_id` IS NOT NULL;
