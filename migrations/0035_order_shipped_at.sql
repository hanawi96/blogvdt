-- Mốc thời điểm đơn đã gửi.
ALTER TABLE `orders` ADD `shipped_at` integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `orders_shipped_at_idx` ON `orders` (`shipped_at`,`id`);
--> statement-breakpoint
-- Backfill từ lần tải export đầu tiên (nếu có).
UPDATE `orders`
SET `shipped_at` = (
  SELECT MIN(`e`.`downloaded_at`)
  FROM `order_export_items` AS `i`
  INNER JOIN `order_exports` AS `e` ON `e`.`id` = `i`.`export_id`
  WHERE `i`.`order_id` = `orders`.`id`
    AND `e`.`downloaded_at` IS NOT NULL
)
WHERE `shipped_at` IS NULL
  AND (
    `fulfill_status` = 'shipped'
    OR (`fulfill_status` IS NULL AND `status` = 'shipped')
  );
--> statement-breakpoint
-- Đơn đã gửi còn thiếu mốc: dùng updated_at tạm thời.
UPDATE `orders`
SET `shipped_at` = `updated_at`
WHERE `shipped_at` IS NULL
  AND (
    `fulfill_status` = 'shipped'
    OR (`fulfill_status` IS NULL AND `status` = 'shipped')
  );
