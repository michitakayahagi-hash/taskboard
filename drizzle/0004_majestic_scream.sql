CREATE TABLE `project_sessions` (
	`token` varchar(128) NOT NULL,
	`projectId` varchar(64) NOT NULL,
	`memberId` int NOT NULL,
	`role` enum('viewer','editor') NOT NULL DEFAULT 'viewer',
	`name` varchar(100) NOT NULL,
	`isAdmin` boolean NOT NULL DEFAULT false,
	`exp` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `project_sessions_token` PRIMARY KEY(`token`)
);
