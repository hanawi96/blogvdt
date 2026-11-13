ALTER TABLE `orders` ADD `province_code` text;
--> statement-breakpoint
CREATE INDEX `orders_province_code_idx` ON `orders` (`province_code`);
