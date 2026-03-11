ALTER TABLE `bridge_node` ADD `coordinator` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_bridge_node` (
	`session_id` text PRIMARY KEY,
	`bridge_id` text NOT NULL,
	`role` text NOT NULL,
	`directory` text NOT NULL,
	`node_url` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`limit` integer DEFAULT 3 NOT NULL,
	`coordinator` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_bridge_node_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_bridge_node`(`session_id`, `bridge_id`, `role`, `directory`, `node_url`, `status`, `limit`, `coordinator`, `time_created`, `time_updated`) SELECT `session_id`, `bridge_id`, `role`, `directory`, `node_url`, `status`, `limit`, `coordinator`, `time_created`, `time_updated` FROM `bridge_node`;--> statement-breakpoint
DROP TABLE `bridge_node`;--> statement-breakpoint
ALTER TABLE `__new_bridge_node` RENAME TO `bridge_node`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `bridge_node_bridge_idx` ON `bridge_node` (`bridge_id`);