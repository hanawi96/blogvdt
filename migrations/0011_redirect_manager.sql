ALTER TABLE `redirects` ADD `status_code` integer DEFAULT 301 NOT NULL;
--> statement-breakpoint
ALTER TABLE `redirects` ADD `enabled` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `redirects` ADD `updated_at` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `redirects` SET `updated_at` = `created_at` WHERE `updated_at` = 0;
--> statement-breakpoint
CREATE INDEX `redirects_to_path_idx` ON `redirects` (`to_path`);
