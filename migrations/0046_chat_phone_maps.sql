CREATE TABLE `chat_phone_maps` (
	`channel` text NOT NULL,
	`chat_id` text NOT NULL,
	`phone` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`channel`, `chat_id`),
	CHECK (`channel` in ('pancake', 'zalo'))
);
