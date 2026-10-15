ALTER TABLE `product_categories` ADD `cover_media_id` integer REFERENCES `media`(`id`) ON DELETE set null;
