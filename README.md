# Hutch Core

The simplest self-hostable MCP server for structured agent data.

Hutch Core is headless, single-user, and batteries-not-included. Point an MCP client (Claude Code, Cursor, Codex, VS Code) at it, tell your agent "save this," and get a queryable, schema-optional JSONB record store — no dashboard, no login screens, no OAuth ceremony. Just an MCP endpoint and a Postgres database.

This is the OSS engine. The multi-user product with a web dashboard, published views, social login, and org sharing is [Hutch Cloud](https://app.hutchdb.com) — see [What moved to Hutch Cloud](#what-moved-to-hutch-cloud) below.

## Quickstart with Docker

```bash
git clone https://github.com/ExpeditedProjects/hutch-core
cd hutch-core

# Optional: require a bearer token on every MCP call.
export HUTCH_API_KEY="$(openssl rand -hex 32)"

docker compose up
```

Core migrates the database and boots on port 3000. The singleton user + personal org are inserted lazily on the first authenticated MCP or REST request — there is no seed step.

## Quickstart without Docker

```bash
git clone https://github.com/ExpeditedProjects/hutch-core
cd hutch-core
npm install
cp .env.local.example .env.local
# Required: HUTCH_DATABASE_URL
# Optional: HUTCH_API_KEY (if unset, all requests are trusted — fine for
# localhost, not fine for a public host)
npm run db:migrate
npm run dev
```

The MCP endpoint is at `http://localhost:3111/api/mcp` (dev) or `http://localhost:3000/api/mcp` (production / Docker).

## Connecting an MCP client

If `HUTCH_API_KEY` is set, every MCP request must include an `Authorization: Bearer <key>` header. If it is unset, Core accepts anonymous requests (single-user local mode).

### Claude Code

```json
{
  "mcpServers": {
    "hutch": {
      "type": "http",
      "url": "http://localhost:3000/api/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_HUTCH_API_KEY"
      }
    }
  }
}
```

### Cursor / VS Code

Both accept the same HTTP MCP server shape as above — set the `url` to your Core endpoint and pass the bearer token in `headers.Authorization`.

### Testing the endpoint

```bash
curl -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $HUTCH_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

You should see the list of `hutch_*` tools (collections, records, schema, views).

## What moved to Hutch Cloud

Core is intentionally small. If you want any of these, either run [Hutch Cloud](https://app.hutchdb.com) or fork Core and add them yourself:

- Web dashboard (`/dashboard`, collection browser, record grid, view editor)
- Published views and public read-only pages (`/p/[slug]`, submission forms)
- OAuth 2.1 authorization server (`/api/oauth/*`, `/.well-known/oauth-*`)
- Social login (GitHub, Google), password auth, session cookies
- Multi-user organizations, invitations, member roles, sharing
- Email delivery for invitations
- Quota enforcement / billing hooks

> **claude.ai web requires OAuth.** Because Core does not ship an OAuth authorization server, adding a Core instance to claude.ai (the web app) will not work out of the box — that flow needs Hutch Cloud, or you need to layer your own OAuth AS in front of Core. Claude Code, Cursor, Codex, and VS Code all accept a static bearer token and work fine.

## Architecture

- **Next.js 16 App Router** — one static landing page, one MCP route (`/api/mcp`), one REST seed route (`/api/v1/collections`). Everything else is deleted.
- **Drizzle + Postgres** — records stored as JSONB, queried via containment operators and full-text search.
- **MCP server** — collection tools, record tools (store/query/search/update/delete/status/transform), schema tools (describe/infer/update), view tools, file tools (put/get/list — small text files store inline; binary or >256KB files use S3-compatible blob storage via the optional `HUTCH_S3_*` env vars).
- **Auth seam** at `src/lib/auth/seam.ts` — if `HUTCH_API_KEY` is set, `authenticate()` requires a matching `Authorization: Bearer <key>`; otherwise it resolves the singleton context. The seam is the only place auth lives.
- **Singleton bootstrap** at `src/lib/auth/singleton.ts` — one user, one personal org, inserted lazily on first request.

## Smoke test

```bash
# Anonymous mode (HUTCH_API_KEY unset)
SMOKE_BASE_URL=http://localhost:3000 npm run smoke

# Keyed mode
SMOKE_BASE_URL=http://localhost:3000 SMOKE_API_KEY=... npm run smoke
```

## License

AGPL v3 — see [LICENSE](LICENSE). Contributors sign a CLA so the maintainer can dual-license into Hutch Cloud — see [CONTRIBUTING.md](CONTRIBUTING.md) and [CLA.md](CLA.md).

## Status

Core is stable enough for a single-user self-host. Breaking changes land on `main`; pin a commit if you need stability.
