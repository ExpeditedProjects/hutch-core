-- Drop api_keys entirely. The MCP OAuth flow is the only remaining auth
-- path; OAuth tokens carry their own org context via mcp_access_tokens.

ALTER TABLE "collections" DROP CONSTRAINT IF EXISTS "collections_api_key_id_fkey";
--> statement-breakpoint
ALTER TABLE "collections" DROP CONSTRAINT IF EXISTS "collections_api_key_id_api_keys_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_collections_api_key_name";
--> statement-breakpoint
ALTER TABLE "collections" DROP COLUMN IF EXISTS "api_key_id";
--> statement-breakpoint

-- (org, name) replaces the (api_key, name) uniqueness invariant: two
-- collections in the same org can't share a display name.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_collections_org_name" ON "collections" ("organization_id", "name");
--> statement-breakpoint

DROP TABLE IF EXISTS "api_keys" CASCADE;
--> statement-breakpoint

-- The "system" org was a backstop for orphaned api_keys; with api_keys
-- gone, no rows should reference it. Drop it if it exists and is empty.
DELETE FROM "organizations" WHERE "slug" = 'system'
  AND NOT EXISTS (SELECT 1 FROM "collections" WHERE "organization_id" = "organizations"."id")
  AND NOT EXISTS (SELECT 1 FROM "mcp_access_tokens" WHERE "organization_id" = "organizations"."id")
  AND NOT EXISTS (SELECT 1 FROM "mcp_refresh_tokens" WHERE "organization_id" = "organizations"."id");
