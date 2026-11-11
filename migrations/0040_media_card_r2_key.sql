ALTER TABLE `media` ADD `card_r2_key` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `media_card_r2_key_uidx` ON `media` (`card_r2_key`);
