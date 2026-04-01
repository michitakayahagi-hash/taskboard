CREATE TABLE `invitations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` varchar(64) NOT NULL,
	`email` varchar(320) NOT NULL,
	`token` varchar(128) NOT NULL,
	`role` enum('viewer','editor') NOT NULL DEFAULT 'viewer',
	`isAdmin` boolean NOT NULL DEFAULT false,
	`status` enum('pending','accepted','expired') NOT NULL DEFAULT 'pending',
	`invitedBy` int,
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `invitations_id` PRIMARY KEY(`id`),
	CONSTRAINT `invitations_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
ALTER TABLE `project_members` ADD `email` varchar(320);--> statement-breakpoint
ALTER TABLE `project_members` ADD `isAdmin` boolean DEFAULT false NOT NULL;