CREATE TABLE `customers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`phone` text NOT NULL,
	`name` text NOT NULL,
	`address` text NOT NULL,
	`hidden_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_phone_uidx` ON `customers` (`phone`);
--> statement-breakpoint
CREATE INDEX `customers_hidden_at_idx` ON `customers` (`hidden_at`);
--> statement-breakpoint
CREATE INDEX `customers_name_idx` ON `customers` (`name`);
--> statement-breakpoint
ALTER TABLE `orders` ADD `customer_id` integer REFERENCES `customers`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX `orders_customer_id_idx` ON `orders` (`customer_id`);
--> statement-breakpoint
INSERT INTO `customers` (`phone`, `name`, `address`, `created_at`, `updated_at`)
SELECT
	`phone`,
	(
		SELECT `customer_name` FROM `orders` AS `o2`
		WHERE `o2`.`phone` = `orders`.`phone`
		ORDER BY `o2`.`created_at` DESC, `o2`.`id` DESC
		LIMIT 1
	),
	(
		SELECT `address` FROM `orders` AS `o2`
		WHERE `o2`.`phone` = `orders`.`phone`
		ORDER BY `o2`.`created_at` DESC, `o2`.`id` DESC
		LIMIT 1
	),
	MIN(`created_at`),
	MAX(`created_at`)
FROM `orders`
GROUP BY `phone`;
--> statement-breakpoint
UPDATE `orders` SET `customer_id` = (
	SELECT `customers`.`id` FROM `customers` WHERE `customers`.`phone` = `orders`.`phone`
);
