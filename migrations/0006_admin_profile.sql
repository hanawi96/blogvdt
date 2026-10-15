ALTER TABLE `admin_users` ADD `avatar_media_id` integer REFERENCES `media`(`id`) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `admin_users` ADD `bio` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `admin_users` ADD `facebook_url` text;--> statement-breakpoint
ALTER TABLE `admin_users` ADD `zalo_url` text;--> statement-breakpoint
ALTER TABLE `admin_users` ADD `instagram_url` text;--> statement-breakpoint
ALTER TABLE `admin_users` ADD `tiktok_url` text;--> statement-breakpoint
ALTER TABLE `admin_users` ADD `website_url` text;
