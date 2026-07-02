ALTER TABLE "collection_invitations" ADD COLUMN IF NOT EXISTS "delivered_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "collection_invitations" ADD COLUMN IF NOT EXISTS "delivery_error" text;
