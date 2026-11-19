ALTER TABLE `chat_phone_maps` ADD `dismissed_at` integer;
CREATE INDEX `chat_phone_maps_phone_idx` ON `chat_phone_maps` (`phone`);
CREATE INDEX `chat_phone_maps_dismissed_at_idx` ON `chat_phone_maps` (`dismissed_at`);
