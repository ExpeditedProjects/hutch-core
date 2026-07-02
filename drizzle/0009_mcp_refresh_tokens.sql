CREATE TABLE IF NOT EXISTS "mcp_refresh_tokens" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"client_id" text NOT NULL,
	"scope" text DEFAULT 'mcp' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mcp_refresh_tokens" ADD CONSTRAINT "mcp_refresh_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_mcp_refresh_tokens_expires_at" ON "mcp_refresh_tokens" ("expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_mcp_access_tokens_expires_at" ON "mcp_access_tokens" ("expires_at");
