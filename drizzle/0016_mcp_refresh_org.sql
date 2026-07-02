-- mcp_refresh_tokens.organization_id: refresh keeps the org context so that
-- the new access token issued at refresh time targets the same org as the
-- original grant.
ALTER TABLE "mcp_refresh_tokens" ADD COLUMN IF NOT EXISTS "organization_id" text;
--> statement-breakpoint
UPDATE "mcp_refresh_tokens" t
SET "organization_id" = o.id
FROM "organizations" o
WHERE o.slug = 'personal-' || t."user_id"
	AND t."organization_id" IS NULL;
--> statement-breakpoint
UPDATE "mcp_refresh_tokens"
SET "organization_id" = (SELECT id FROM "organizations" WHERE slug = 'system')
WHERE "organization_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "mcp_refresh_tokens" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mcp_refresh_tokens" ADD CONSTRAINT "mcp_refresh_tokens_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
