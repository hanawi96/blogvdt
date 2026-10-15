ALTER TABLE `posts` ADD `author_id` integer REFERENCES `admin_users`(`id`) ON DELETE set null;
--> statement-breakpoint
-- Bài cũ lấy người tạo từ nhật ký: dòng tạo bài ghi cùng mốc thời gian với posts.created_at.
UPDATE `posts` SET `author_id` = (
  SELECT `activity_logs`.`actor_id` FROM `activity_logs`
  WHERE `activity_logs`.`object_type` = 'post'
    AND `activity_logs`.`object_id` = CAST(`posts`.`id` AS TEXT)
    AND `activity_logs`.`action` IN ('post.create', 'post.publish')
    AND `activity_logs`.`created_at` = `posts`.`created_at`
  ORDER BY `activity_logs`.`id`
  LIMIT 1
)
WHERE `author_id` IS NULL;
