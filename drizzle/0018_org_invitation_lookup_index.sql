-- Speeds up the "active invitations for an org" listing query used by
-- the org members page and the MCP list_organization_invitations tool.
CREATE INDEX IF NOT EXISTS "idx_organization_invitations_org_expiry"
  ON "organization_invitations" ("organization_id", "expires_at");
