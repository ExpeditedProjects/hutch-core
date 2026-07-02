-- Organizations and org membership

CREATE TABLE IF NOT EXISTS "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"personal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_members" (
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_members_pk" PRIMARY KEY ("organization_id","user_id"),
	CONSTRAINT "organization_members_role_check" CHECK ("role" IN ('member','admin'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_organization_members_user" ON "organization_members" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"invited_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"delivered_at" timestamp with time zone,
	"delivery_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_invitations_role_check" CHECK ("role" IN ('member','admin')),
	CONSTRAINT "organization_invitations_org_email_unique" UNIQUE ("organization_id", "email")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_invited_by_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_organization_invitations_email" ON "organization_invitations" ("email");
--> statement-breakpoint

-- Backfill: create a personal org for every existing user, set them as admin.
-- The slug "personal-<userId>" is stable and unique; it is intentionally
-- opaque because the UI does not surface personal orgs until the user
-- creates a real org.
INSERT INTO "organizations" ("id", "slug", "name", "personal", "created_at", "updated_at")
SELECT
	gen_random_uuid()::text,
	'personal-' || u.id,
	COALESCE(NULLIF(trim(u.name), ''), split_part(u.email, '@', 1)) || '''s workspace',
	true,
	now(),
	now()
FROM "user" u
ON CONFLICT (slug) DO NOTHING;
--> statement-breakpoint
INSERT INTO "organization_members" ("organization_id", "user_id", "role", "created_at", "updated_at")
SELECT o.id, u.id, 'admin', now(), now()
FROM "user" u
JOIN "organizations" o ON o.slug = 'personal-' || u.id
ON CONFLICT ("organization_id", "user_id") DO NOTHING;
--> statement-breakpoint

-- Fallback org for orphaned api_keys / mcp tokens (api_keys.user_id is nullable
-- for service keys). New rows should never use this; it exists to satisfy the
-- NOT NULL constraint for any pre-existing orphans.
INSERT INTO "organizations" ("id", "slug", "name", "personal", "created_at", "updated_at")
VALUES (gen_random_uuid()::text, 'system', 'System', false, now(), now())
ON CONFLICT (slug) DO NOTHING;
--> statement-breakpoint

-- api_keys.organization_id: add nullable, backfill from user's personal org,
-- fall back to the system org for keys with no user, then enforce NOT NULL.
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "organization_id" text;
--> statement-breakpoint
UPDATE "api_keys" ak
SET "organization_id" = o.id
FROM "user" u, "organizations" o
WHERE ak."user_id" = u.id
	AND o.slug = 'personal-' || u.id
	AND ak."organization_id" IS NULL;
--> statement-breakpoint
UPDATE "api_keys"
SET "organization_id" = (SELECT id FROM "organizations" WHERE slug = 'system')
WHERE "organization_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- collections.organization_id: derive from owning api_key.
ALTER TABLE "collections" ADD COLUMN IF NOT EXISTS "organization_id" text;
--> statement-breakpoint
UPDATE "collections" c
SET "organization_id" = ak."organization_id"
FROM "api_keys" ak
WHERE c."api_key_id" = ak.id
	AND c."organization_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "collections" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "collections" ADD CONSTRAINT "collections_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_collections_organization" ON "collections" ("organization_id");
--> statement-breakpoint

-- visibility + org_default_role default to private/viewer so existing
-- collections behave exactly as they did before this migration.
ALTER TABLE "collections" ADD COLUMN IF NOT EXISTS "visibility" text NOT NULL DEFAULT 'private';
--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN IF NOT EXISTS "org_default_role" text NOT NULL DEFAULT 'viewer';
--> statement-breakpoint
ALTER TABLE "collections" DROP CONSTRAINT IF EXISTS "collections_visibility_check";
--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_visibility_check" CHECK ("visibility" IN ('private','org'));
--> statement-breakpoint
ALTER TABLE "collections" DROP CONSTRAINT IF EXISTS "collections_org_default_role_check";
--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_org_default_role_check" CHECK ("org_default_role" IN ('viewer','editor'));
--> statement-breakpoint

-- mcp_access_tokens.organization_id: derive from user's personal org.
ALTER TABLE "mcp_access_tokens" ADD COLUMN IF NOT EXISTS "organization_id" text;
--> statement-breakpoint
UPDATE "mcp_access_tokens" t
SET "organization_id" = o.id
FROM "organizations" o
WHERE o.slug = 'personal-' || t."user_id"
	AND t."organization_id" IS NULL;
--> statement-breakpoint
UPDATE "mcp_access_tokens"
SET "organization_id" = (SELECT id FROM "organizations" WHERE slug = 'system')
WHERE "organization_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "mcp_access_tokens" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mcp_access_tokens" ADD CONSTRAINT "mcp_access_tokens_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
