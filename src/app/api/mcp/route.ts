import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@/lib/mcp/server";
import { authenticate } from "@/lib/auth/seam";
import { config } from "@/lib/config";

function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleMcpRequest(req: Request): Promise<Response> {
  const ctx = await authenticate(req);
  if (!ctx) return unauthorizedResponse();

  const server = createMcpServer(ctx.userId, ctx.orgId, config.baseUrl);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await server.server.connect(transport);
  return transport.handleRequest(req);
}

export const GET = handleMcpRequest;
export const POST = handleMcpRequest;
export const DELETE = handleMcpRequest;
