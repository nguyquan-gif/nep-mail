CREATE TABLE `signup_forms` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`tag` text DEFAULT '' NOT NULL,
	`locale` text DEFAULT 'vi' NOT NULL,
	`consent_source` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `signup_form_slug` ON `signup_forms` (`slug`);--> statement-breakpoint
CREATE TABLE `signup_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`form_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`token_digest` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`used_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`form_id`) REFERENCES `signup_forms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `signup_request_token` ON `signup_requests` (`token_digest`);--> statement-breakpoint
CREATE INDEX `signup_request_form_email` ON `signup_requests` (`form_id`,`email`);