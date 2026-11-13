CREATE TABLE `feedback_photos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_id` integer,
	`public_path` text,
	`alt_text` text DEFAULT '' NOT NULL,
	`width` integer,
	`height` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'published' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE cascade,
	CHECK ((`media_id` IS NOT NULL AND `public_path` IS NULL) OR (`media_id` IS NULL AND `public_path` IS NOT NULL)),
	CHECK (`status` IN ('published', 'hidden'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feedback_photos_media_uidx` ON `feedback_photos` (`media_id`);
--> statement-breakpoint
CREATE INDEX `feedback_photos_public_list_idx` ON `feedback_photos` (`status`, `sort_order`, `id`);
--> statement-breakpoint
INSERT INTO `feedback_photos` (`public_path`, `alt_text`, `width`, `height`, `sort_order`, `status`, `created_at`) VALUES
	('/Images/feedback/1.webp', 'Ảnh phản hồi mua hàng từ khách', 600, 752, 10, 'published', 0),
	('/Images/feedback/2.webp', 'Ảnh phản hồi mua hàng từ khách', 600, 752, 20, 'published', 0),
	('/Images/feedback/3.webp', 'Ảnh phản hồi mua hàng từ khách', 600, 752, 30, 'published', 0),
	('/Images/feedback/4.webp', 'Ảnh phản hồi mua hàng từ khách', 600, 752, 40, 'published', 0),
	('/Images/feedback/5.webp', 'Ảnh phản hồi mua hàng từ khách', 600, 752, 50, 'published', 0),
	('/Images/feedback/6.webp', 'Ảnh phản hồi mua hàng từ khách', 600, 752, 60, 'published', 0),
	('/Images/feedback/7.webp', 'Ảnh phản hồi mua hàng từ khách', 600, 752, 70, 'published', 0),
	('/Images/feedback/8.webp', 'Ảnh phản hồi mua hàng từ khách', 600, 752, 80, 'published', 0),
	('/Images/feedback/9.webp', 'Ảnh phản hồi mua hàng từ khách', 600, 752, 90, 'published', 0),
	('/Images/feedback/10.webp', 'Ảnh phản hồi mua hàng từ khách', 600, 752, 100, 'published', 0);
