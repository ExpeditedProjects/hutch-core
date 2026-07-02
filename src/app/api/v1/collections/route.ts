import { authenticate } from "@/lib/auth/seam";
import { listCollections } from "@/lib/services/collections";

export async function GET(req: Request) {
  const ctx = await authenticate(req);
  if (!ctx) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const collections = await listCollections(ctx.userId, ctx.orgId);
  return new Response(JSON.stringify(collections), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
