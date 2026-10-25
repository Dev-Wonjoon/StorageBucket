CREATE TABLE `download_urls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`url` text NOT NULL,
	`video_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `download_urls_url_unique` ON `download_urls` (`url`);--> statement-breakpoint
ALTER TABLE `media` ADD `url_id` integer REFERENCES download_urls(id);--> statement-breakpoint
ALTER TABLE `media` DROP COLUMN `url`;--> statement-breakpoint
ALTER TABLE `media` DROP COLUMN `video_id`;