CREATE TABLE `home_collections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`subtitle` text,
	`kind` text NOT NULL,
	`product_ids_json` text NOT NULL DEFAULT '[]',
	`rule_json` text,
	`active` integer NOT NULL DEFAULT 1,
	`sort_order` integer NOT NULL DEFAULT 0,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `home_collections_kind_check` CHECK(`kind` in ('products', 'pair_discount', 'bracelet_addon')),
	CONSTRAINT `home_collections_active_check` CHECK(`active` in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `home_collections_slug_unique` ON `home_collections` (`slug`);
--> statement-breakpoint
CREATE INDEX `home_collections_active_sort_idx` ON `home_collections` (`active`, `sort_order`, `id`);
--> statement-breakpoint
INSERT INTO `home_collections` (`slug`, `title`, `subtitle`, `kind`, `product_ids_json`, `rule_json`, `active`, `sort_order`, `created_at`, `updated_at`)
VALUES
	('mau-hot-2026', 'Mẫu hot 2026', 'Những mẫu mẹ đang chọn nhiều.', 'products', '[]', NULL, 0, 0, 0, 0),
	('combo-mua-2', 'Combo mua 2 giảm', 'Chọn mẫu rồi mua 2 chiếc cho tiện.', 'pair_discount', '[]', '{"buyQty":2}', 0, 1, 0, 0),
	('vong-kem-bo-dau', 'Vòng + bán kèm', 'Mua kèm bó dâu — thường được miễn ship.', 'bracelet_addon', '[]', NULL, 0, 2, 0, 0);
