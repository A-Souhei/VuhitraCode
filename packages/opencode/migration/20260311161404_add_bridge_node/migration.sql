CREATE TABLE `bridge_node` (
	`session_id` text PRIMARY KEY,
	`bridge_id` text NOT NULL,
	`role` text NOT NULL,
	`directory` text NOT NULL,
	`node_url` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`limit` integer DEFAULT 8 NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_bridge_node_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `todo` ADD `assigned_to` text;--> statement-breakpoint
ALTER TABLE `todo` ADD `scout_id` text;--> statement-breakpoint
CREATE INDEX `bridge_node_bridge_idx` ON `bridge_node` (`bridge_id`);