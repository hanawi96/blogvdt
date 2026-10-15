CREATE TABLE `seo_health_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`phase` text DEFAULT 'posts' NOT NULL,
	`cursor` integer DEFAULT 0 NOT NULL,
	`links_truncated` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `seo_health_runs_phase_check` CHECK(`phase` in ('posts', 'links', 'inbound', 'done'))
);
--> statement-breakpoint
CREATE TABLE `seo_health_posts` (
	`run_id` integer NOT NULL,
	`post_id` integer NOT NULL,
	PRIMARY KEY(`run_id`, `post_id`),
	FOREIGN KEY (`run_id`) REFERENCES `seo_health_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `seo_health_links` (
	`run_id` integer NOT NULL,
	`path` text NOT NULL,
	PRIMARY KEY(`run_id`, `path`),
	FOREIGN KEY (`run_id`) REFERENCES `seo_health_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `seo_health_issues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`post_id` integer,
	`post_title` text DEFAULT '' NOT NULL,
	`severity` text NOT NULL,
	`code` text NOT NULL,
	`detail` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `seo_health_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `seo_health_issues_severity_check` CHECK(`severity` in ('error', 'warning'))
);
--> statement-breakpoint
CREATE INDEX `seo_health_issues_filter_idx` ON `seo_health_issues` (`run_id`,`severity`,`code`,`post_id`);
