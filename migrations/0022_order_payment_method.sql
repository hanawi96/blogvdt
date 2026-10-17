ALTER TABLE `orders` ADD `payment_method` text DEFAULT 'cod' NOT NULL CHECK (`payment_method` in ('cod', 'bank'));
