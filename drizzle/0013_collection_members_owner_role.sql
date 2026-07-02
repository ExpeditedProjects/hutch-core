ALTER TABLE "collection_members" DROP CONSTRAINT IF EXISTS "collection_members_role_check";
--> statement-breakpoint
ALTER TABLE "collection_members" ADD CONSTRAINT "collection_members_role_check" CHECK ("role" IN ('viewer','editor','owner'));
--> statement-breakpoint
INSERT INTO "collection_members" ("collection_id", "user_id", "role", "created_at", "updated_at")
SELECT c.id, ak.user_id, 'owner', now(), now()
FROM "collections" c
JOIN "api_keys" ak ON ak.id = c.api_key_id
WHERE ak.user_id IS NOT NULL
ON CONFLICT ("collection_id", "user_id") DO UPDATE SET role = 'owner', updated_at = now();
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "collection_members_one_owner" ON "collection_members" ("collection_id") WHERE "role" = 'owner';
