#!/bin/sh
set -e

: "${HUTCH_DATABASE_URL:?HUTCH_DATABASE_URL is required}"

node scripts/docker-migrate.js

# Core self-bootstraps its singleton user + personal org on first request via
# src/lib/auth/singleton.ts, so there is no seed step here.

exec "$@"
