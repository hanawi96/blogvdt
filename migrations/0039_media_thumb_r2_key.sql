ALTER TABLE `media` ADD `thumb_r2_key` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `media_thumb_r2_key_uidx` ON `media` (`thumb_r2_key`);
