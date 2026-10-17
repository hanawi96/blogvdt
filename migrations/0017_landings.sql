CREATE TABLE `landings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`blocks_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`robots` text DEFAULT 'noindex' NOT NULL,
	`seo_title` text,
	`meta_description` text,
	`og_media_id` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`og_media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT `landings_status_check` CHECK(`status` in ('draft', 'published')),
	CONSTRAINT `landings_robots_check` CHECK(`robots` in ('noindex', 'index'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `landings_slug_unique` ON `landings` (`slug`);
--> statement-breakpoint
CREATE INDEX `landings_status_idx` ON `landings` (`status`);
