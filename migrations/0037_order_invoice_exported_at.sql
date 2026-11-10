ALTER TABLE `orders` ADD `invoice_exported_at` integer;
--> statement-breakpoint
CREATE INDEX `orders_invoice_exported_at_idx` ON `orders` (`invoice_exported_at`,`shipped_at`,`id`);
