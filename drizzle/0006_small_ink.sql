ALTER TABLE `download_queue` ADD `title` text;--> statement-breakpoint
ALTER TABLE `download_queue` ADD `thumbnail` text;--> statement-breakpoint
ALTER TABLE `download_queue` ADD `error_message` text;--> statement-breakpoint
ALTER TABLE `download_queue` ADD `log` text;--> statement-breakpoint
ALTER TABLE `download_queue` ADD `started_at` integer;--> statement-breakpoint
ALTER TABLE `download_queue` ADD `finished_at` integer;