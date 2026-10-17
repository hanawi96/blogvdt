ALTER TABLE `orders` ADD `landing_slug` text;
--> statement-breakpoint
ALTER TABLE `landings` ADD `views` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX `orders_landing_idx` ON `orders` (`landing_slug`);
