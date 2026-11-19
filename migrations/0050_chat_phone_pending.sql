ALTER TABLE `chat_phone_maps` ADD `pending` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
UPDATE `chat_phone_maps` SET `pending` = 0 WHERE `dismissed_at` IS NOT NULL;--> statement-breakpoint
UPDATE `chat_phone_maps` SET `pending` = 0
WHERE `pending` = 1
  AND EXISTS (
    SELECT 1 FROM `orders`
    WHERE `orders`.`phone` = `chat_phone_maps`.`phone`
      AND `orders`.`status` <> 'cancelled'
  );--> statement-breakpoint
CREATE INDEX `chat_phone_maps_pending_updated_idx` ON `chat_phone_maps` (`pending`, `updated_at`);
