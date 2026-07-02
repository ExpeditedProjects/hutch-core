-- The pending-invitation listing joins on `lower(email)` to be case-
-- insensitive (both org and collection invitations). The plain
-- (email) index is a B-tree on the raw column; wrapping with lower()
-- prevents its use. Add functional indexes that match the lookup
-- shape directly.
CREATE INDEX IF NOT EXISTS "idx_organization_invitations_email_lower"
  ON "organization_invitations" (lower("email"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_collection_invitations_email_lower"
  ON "collection_invitations" (lower("email"));
