ALTER TABLE `product_categories` ADD `qty_min` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `product_categories` ADD `qty_max` integer DEFAULT 20 NOT NULL;
--> statement-breakpoint
UPDATE `product_categories` SET `qty_min` = 10, `qty_max` = 500 WHERE `slug` = 'hat-dau-tam-mai-san';
