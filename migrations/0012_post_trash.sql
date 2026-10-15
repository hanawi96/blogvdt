ALTER TABLE `posts` ADD `deleted_at` integer;
--> statement-breakpoint
ALTER TABLE `posts` ADD `deleted_by` integer;
--> statement-breakpoint
CREATE INDEX `posts_deleted_at_idx` ON `posts` (`deleted_at`);
