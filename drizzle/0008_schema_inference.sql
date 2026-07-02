ALTER TABLE "records" ADD COLUMN "status" text DEFAULT 'active';
--> statement-breakpoint
ALTER TABLE "views" ADD COLUMN "type" text DEFAULT 'table';
--> statement-breakpoint
ALTER TABLE "views" ADD COLUMN "config" jsonb DEFAULT '{}';
