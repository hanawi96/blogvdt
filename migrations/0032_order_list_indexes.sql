CREATE INDEX IF NOT EXISTS `orders_list_idx` ON `orders` (`priority`, `created_at`, `id`);
CREATE INDEX IF NOT EXISTS `orders_fulfill_status_idx` ON `orders` (`fulfill_status`);
CREATE INDEX IF NOT EXISTS `orders_source_idx` ON `orders` (`source`);
CREATE INDEX IF NOT EXISTS `orders_payment_method_idx` ON `orders` (`payment_method`);
