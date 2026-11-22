ALTER TABLE `product_comments` ADD `admin_user_id` integer REFERENCES `admin_users`(`id`) ON DELETE set null;
--> statement-breakpoint
CREATE INDEX `product_comments_admin_user_idx` ON `product_comments` (`admin_user_id`);
--> statement-breakpoint
UPDATE `product_comments`
SET `admin_user_id` = (
	SELECT `id` FROM `admin_users`
	WHERE trim(`display_name`) = trim(`product_comments`.`author_name`)
	LIMIT 1
)
WHERE `author_kind` = 'shop' AND `admin_user_id` IS NULL;
