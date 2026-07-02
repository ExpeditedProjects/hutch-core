-- Migration: Switch from Auth.js to Better Auth schema + add OIDC tables for MCP

-- Drop old Auth.js tables
DROP TABLE IF EXISTS "verificationToken" CASCADE;
DROP TABLE IF EXISTS "session" CASCADE;
DROP TABLE IF EXISTS "account" CASCADE;

-- Alter user table to match Better Auth expectations
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "email_verified" boolean NOT NULL DEFAULT false;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT now() NOT NULL;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;

-- Make name not null (Better Auth requires it)
UPDATE "user" SET name = split_part(email, '@', 1) WHERE name IS NULL;
ALTER TABLE "user" ALTER COLUMN "name" SET NOT NULL;

-- Make email not null
ALTER TABLE "user" ALTER COLUMN "email" SET NOT NULL;

-- Drop old emailVerified column if exists
ALTER TABLE "user" DROP COLUMN IF EXISTS "emailVerified";

-- Create Better Auth session table
CREATE TABLE IF NOT EXISTS "session" (
  "id" text PRIMARY KEY,
  "expires_at" timestamp NOT NULL,
  "token" text NOT NULL UNIQUE,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "ip_address" text,
  "user_agent" text,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
);

-- Create Better Auth account table
CREATE TABLE IF NOT EXISTS "account" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "account_id" text NOT NULL,
  "provider_id" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "access_token" text,
  "refresh_token" text,
  "id_token" text,
  "access_token_expires_at" timestamp,
  "refresh_token_expires_at" timestamp,
  "scope" text,
  "password" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- Create Better Auth verification table
CREATE TABLE IF NOT EXISTS "verification" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp,
  "updated_at" timestamp
);

-- OIDC Provider tables (for MCP OAuth)
CREATE TABLE IF NOT EXISTS "oauth_application" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "icon" text,
  "metadata" text,
  "client_id" text NOT NULL UNIQUE,
  "client_secret" text,
  "redirect_urls" text NOT NULL,
  "type" text NOT NULL DEFAULT 'web',
  "disabled" boolean NOT NULL DEFAULT false,
  "user_id" text REFERENCES "user"("id") ON DELETE CASCADE,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "oauth_access_token" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "access_token" text NOT NULL UNIQUE,
  "refresh_token" text NOT NULL UNIQUE,
  "access_token_expires_at" timestamp NOT NULL,
  "refresh_token_expires_at" timestamp NOT NULL,
  "client_id" text NOT NULL,
  "user_id" text REFERENCES "user"("id") ON DELETE CASCADE,
  "scopes" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "oauth_consent" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_id" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "scopes" text NOT NULL,
  "consent_given" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
