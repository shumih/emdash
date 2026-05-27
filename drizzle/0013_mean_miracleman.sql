ALTER TABLE `conversations` ADD `source_share_id` text;--> statement-breakpoint
ALTER TABLE `conversations` ADD `source_target_provider` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_conversations_source_share` ON `conversations` (`task_id`,`source_share_id`,`source_target_provider`);