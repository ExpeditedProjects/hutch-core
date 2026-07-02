CREATE TABLE IF NOT EXISTS "collection_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"collection_id" integer NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"invited_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_invitations_role_check" CHECK ("role" IN ('viewer','editor')),
	CONSTRAINT "collection_invitations_collection_email_unique" UNIQUE ("collection_id", "email")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "collection_invitations" ADD CONSTRAINT "collection_invitations_collection_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "collection_invitations" ADD CONSTRAINT "collection_invitations_invited_by_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_collection_invitations_email" ON "collection_invitations" ("email");
