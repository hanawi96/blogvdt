CREATE TABLE `pnl_labor_budgets` (
	`month_key` text PRIMARY KEY NOT NULL,
	`amount` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `pnl_labor_budgets_month_check` CHECK(`month_key` glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT `pnl_labor_budgets_amount_check` CHECK(`amount` >= 0)
);
