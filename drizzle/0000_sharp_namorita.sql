CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `daily_rows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`upload_id` text NOT NULL,
	`row_number` integer NOT NULL,
	`date` text DEFAULT '' NOT NULL,
	`page_name` text NOT NULL,
	`item_name` text NOT NULL,
	`item_key` text NOT NULL,
	`ad_account` text DEFAULT '' NOT NULL,
	`cpp` real,
	`cpm` text DEFAULT '' NOT NULL,
	`cod` real NOT NULL,
	`ad_spend` real NOT NULL,
	`orders` integer NOT NULL,
	`budget` real,
	`spent_percent` real,
	`rts_rate_used` real,
	`cog_used` real,
	`net_without_rts` real,
	`net_with_rts` real,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `daily_rows_upload_id_idx` ON `daily_rows` (`upload_id`);--> statement-breakpoint
CREATE INDEX `daily_rows_item_key_idx` ON `daily_rows` (`item_key`);--> statement-breakpoint
CREATE INDEX `daily_rows_date_idx` ON `daily_rows` (`date`);--> statement-breakpoint
CREATE TABLE `product_master` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`effective_date` text DEFAULT '' NOT NULL,
	`item_name` text NOT NULL,
	`item_key` text NOT NULL,
	`rts_rate` real NOT NULL,
	`cog` real NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_master_item_effective_unique` ON `product_master` (`item_key`,`effective_date`);--> statement-breakpoint
CREATE INDEX `product_master_item_key_idx` ON `product_master` (`item_key`);--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`file_name` text NOT NULL,
	`uploaded_at` text NOT NULL,
	`row_count` integer NOT NULL,
	`matched_rows` integer DEFAULT 0 NOT NULL,
	`unmatched_rows` integer DEFAULT 0 NOT NULL,
	`total_ad_spend` real DEFAULT 0 NOT NULL,
	`total_orders` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL
);
