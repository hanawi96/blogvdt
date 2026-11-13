ALTER TABLE `feedback_photos` ADD `pin_rank` integer;
--> statement-breakpoint
CREATE UNIQUE INDEX `feedback_photos_pin_rank_uidx` ON `feedback_photos` (`pin_rank`);
--> statement-breakpoint
DROP INDEX `feedback_photos_public_list_idx`;
--> statement-breakpoint
CREATE INDEX `feedback_photos_public_list_idx` ON `feedback_photos` (`status`, `pin_rank`, `id`);
