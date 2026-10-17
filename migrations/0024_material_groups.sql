CREATE TABLE `material_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_groups_name_unique` ON `material_groups` (lower(`name`));
--> statement-breakpoint
INSERT INTO `material_groups` (`name`, `sort_order`, `created_at`, `updated_at`)
SELECT MIN(`group_name`), ROW_NUMBER() OVER (ORDER BY MIN(`group_name`)) - 1, CAST(strftime('%s', 'now') AS integer) * 1000, CAST(strftime('%s', 'now') AS integer) * 1000
FROM `materials`
GROUP BY lower(`group_name`);
--> statement-breakpoint
ALTER TABLE `materials` ADD `group_id` integer REFERENCES `material_groups`(`id`) ON UPDATE no action ON DELETE restrict;
--> statement-breakpoint
UPDATE `materials` SET `group_id` = (SELECT `g`.`id` FROM `material_groups` `g` WHERE lower(`g`.`name`) = lower(`materials`.`group_name`));
--> statement-breakpoint
DROP INDEX `materials_group_idx`;
--> statement-breakpoint
ALTER TABLE `materials` DROP COLUMN `group_name`;
--> statement-breakpoint
CREATE INDEX `materials_group_id_idx` ON `materials` (`group_id`);
