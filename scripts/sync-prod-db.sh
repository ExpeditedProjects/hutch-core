#!/usr/bin/env bash
# Syncs the production Neon database into the local dev database.
# Destructive: drops and recreates the local database before restoring.

set -euo pipefail

# ── Resolve script and project paths ──────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# ── Args ──────────────────────────────────────────────────────────────────────
SKIP_CONFIRM=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes) SKIP_CONFIRM=1 ;;
    -h|--help)
      echo "Usage: $0 [--yes]"
      echo "  --yes, -y   Skip the destructive-action confirmation prompt"
      exit 0
      ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

# ── Required tools ────────────────────────────────────────────────────────────
for cmd in pg_dump psql npx; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: '$cmd' is required but not installed." >&2
    exit 1
  fi
done

# ── Local DB URL (from .env.local) ────────────────────────────────────────────
if [[ ! -f .env.local ]]; then
  echo "Error: .env.local not found at $PROJECT_ROOT/.env.local" >&2
  exit 1
fi

LOCAL_DB_URL="$(grep -E '^HUTCH_DATABASE_URL=' .env.local | head -1 | cut -d= -f2- | tr -d '"' || true)"
if [[ -z "${LOCAL_DB_URL:-}" ]]; then
  echo "Error: HUTCH_DATABASE_URL not set in .env.local" >&2
  exit 1
fi

if [[ "$LOCAL_DB_URL" != *"localhost"* && "$LOCAL_DB_URL" != *"127.0.0.1"* ]]; then
  echo "Refusing to sync: HUTCH_DATABASE_URL in .env.local is not localhost." >&2
  echo "  $LOCAL_DB_URL" >&2
  exit 1
fi

# Parse local DB name from URL (postgresql://user@host/dbname?...)
LOCAL_DB_NAME_AND_QUERY="${LOCAL_DB_URL##*/}"
LOCAL_DB_NAME="${LOCAL_DB_NAME_AND_QUERY%%\?*}"
LOCAL_ADMIN_URL="${LOCAL_DB_URL/\/${LOCAL_DB_NAME}/\/postgres}"

# ── Production DB URL (pull from Vercel) ──────────────────────────────────────
ENV_FILE="$(mktemp -t hutch-prod-env.XXXXXX)"
trap 'rm -f "$ENV_FILE"' EXIT

echo "→ Pulling production env from Vercel…"
npx vercel env pull "$ENV_FILE" --environment production --yes >/dev/null 2>&1

# Prefer the unpooled URL (pg_dump opens long-lived connections that don't play
# nicely with pgbouncer), fall back to the standard URL.
PROD_DB_URL="$(grep -E '^HUTCH_DATABASE_DATABASE_URL_UNPOOLED=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' || true)"
if [[ -z "${PROD_DB_URL:-}" ]]; then
  PROD_DB_URL="$(grep -E '^HUTCH_DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' || true)"
fi
if [[ -z "${PROD_DB_URL:-}" ]]; then
  echo "Error: could not find production database URL in Vercel env." >&2
  exit 1
fi

# ── Confirm with the user ─────────────────────────────────────────────────────
echo
echo "About to overwrite the local database with production data."
echo "  Source:      Neon (production) — $(echo "$PROD_DB_URL" | sed -E 's|//[^@]+@|//***@|')"
echo "  Destination: $LOCAL_DB_URL"
echo
echo "This drops '$LOCAL_DB_NAME' on the local Postgres and recreates it from"
echo "the production dump. Real user data will land on this machine."
echo
if [[ $SKIP_CONFIRM -eq 0 ]]; then
  read -r -p "Continue? (type 'yes' to proceed) " confirm
  if [[ "$confirm" != "yes" ]]; then
    echo "Aborted."
    exit 0
  fi
else
  echo "(--yes flag set, skipping confirmation)"
fi

# ── Drop and recreate local DB ────────────────────────────────────────────────
echo "→ Terminating active connections to '$LOCAL_DB_NAME'…"
psql "$LOCAL_ADMIN_URL" -v ON_ERROR_STOP=1 -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$LOCAL_DB_NAME' AND pid <> pg_backend_pid();" \
  >/dev/null

echo "→ Dropping and recreating local database '$LOCAL_DB_NAME'…"
psql "$LOCAL_ADMIN_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$LOCAL_DB_NAME\";" >/dev/null
psql "$LOCAL_ADMIN_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$LOCAL_DB_NAME\";" >/dev/null

# ── Dump and restore ──────────────────────────────────────────────────────────
echo "→ Dumping production and restoring locally (this may take a minute)…"
pg_dump \
  --no-owner \
  --no-acl \
  --no-privileges \
  --format=plain \
  "$PROD_DB_URL" \
  | psql -v ON_ERROR_STOP=1 "$LOCAL_DB_URL" >/dev/null

echo
echo "✓ Local database synced from production."
