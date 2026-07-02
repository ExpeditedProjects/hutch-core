CREATE TABLE IF NOT EXISTS "collection_members" (
	"collection_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_members_pk" PRIMARY KEY ("collection_id","user_id"),
	CONSTRAINT "collection_members_role_check" CHECK ("role" IN ('viewer','editor'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "collection_members" ADD CONSTRAINT "collection_members_collection_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "collection_members" ADD CONSTRAINT "collection_members_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_collection_members_user" ON "collection_members" ("user_id");
