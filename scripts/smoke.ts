// Smoke test for Hutch Core.
//
// Runs against a running Core instance (default http://localhost:3000; override
// with SMOKE_BASE_URL). The contract:
//
// - If SMOKE_API_KEY is set: POST /api/mcp with NO Authorization must return
//   401, and with `Authorization: Bearer <SMOKE_API_KEY>` must return a
//   non-401. We do not assert 200 — the transport may return 200 with a
//   JSON-RPC body or a 2xx SSE stream depending on the client's Accept
//   headers.
// - If SMOKE_API_KEY is not set: Core is in anonymous singleton mode. POST
//   /api/mcp with no Authorization must return a non-500 response.
// - In every case, 401 responses must NOT include a WWW-Authenticate header.
//   Core has no OAuth authorization server; the presence of that header would
//   suggest a stale build.

const BASE_URL = (process.env.SMOKE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const API_KEY = process.env.SMOKE_API_KEY;
const MCP_URL = `${BASE_URL}/api/mcp`;

const failures: string[] = [];

function check(condition: unknown, message: string) {
  if (!condition) failures.push(message);
}

function jsonRpcBody(): string {
  return JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 });
}

async function postMcp(headers: Record<string, string> = {}): Promise<Response> {
  return fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: jsonRpcBody(),
  });
}

function assertNoWwwAuthenticate(res: Response, label: string) {
  const wwwAuth = res.headers.get("www-authenticate");
  check(
    wwwAuth === null,
    `${label}: unexpected WWW-Authenticate header "${wwwAuth}" (Core does not run an OAuth AS)`,
  );
}

async function checkKeyed() {
  const unauth = await postMcp();
  check(unauth.status === 401, `${MCP_URL} (no bearer): expected 401, got ${unauth.status}`);
  assertNoWwwAuthenticate(unauth, `${MCP_URL} (no bearer)`);

  const authed = await postMcp({ Authorization: `Bearer ${API_KEY}` });
  check(
    authed.status !== 401,
    `${MCP_URL} (Bearer ${API_KEY?.slice(0, 4)}...): expected non-401, got ${authed.status}`,
  );
}

async function checkAnonymous() {
  const res = await postMcp();
  check(
    res.status < 500,
    `${MCP_URL} (anon): expected non-500 response, got ${res.status}`,
  );
  if (res.status === 401) assertNoWwwAuthenticate(res, `${MCP_URL} (anon 401)`);
}

async function main() {
  const mode = API_KEY ? "keyed" : "anonymous";
  console.log(`smoke: target ${BASE_URL} (${mode} mode)`);

  if (API_KEY) await checkKeyed();
  else await checkAnonymous();

  if (failures.length > 0) {
    console.error(`\nsmoke: ${failures.length} failure(s)`);
    for (const f of failures) console.error(`  x ${f}`);
    process.exit(1);
  }
  console.log("smoke: all checks passed");
}

main().catch((err) => {
  console.error("smoke: threw", err);
  process.exit(1);
});
