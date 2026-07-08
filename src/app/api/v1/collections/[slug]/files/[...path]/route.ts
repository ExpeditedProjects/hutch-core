import { authenticate } from "@/lib/auth/seam";
import { putFile, getFile, deleteFile } from "@/lib/services/files";
import { MAX_FILE_SIZE } from "@/lib/constants";

// REST files endpoint:
//   PUT    — raw body bytes upsert via putFile (mime from Content-Type)
//   GET    — inline files stream their bytes; blob files 302 to the presigned URL
//   DELETE — soft-delete
//
// Next 16: ctx.params is a Promise.
type Ctx = { params: Promise<{ slug: string; path: string[] }> };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function unauthorized(): Response {
  return json({ error: "Unauthorized" }, 401);
}

export async function PUT(req: Request, ctx: Ctx) {
  const auth = await authenticate(req);
  if (!auth) return unauthorized();

  const { slug, path } = await ctx.params;
  const bytes = new Uint8Array(await req.arrayBuffer());

  if (bytes.byteLength > MAX_FILE_SIZE) {
    return json({ error: "File exceeds the 4MB size limit" }, 413);
  }

  const result = await putFile(auth.userId, auth.orgId, {
    collection: slug,
    path: path.join("/"),
    contentBase64: Buffer.from(bytes).toString("base64"),
    mimeType: req.headers.get("content-type") ?? "application/octet-stream",
  });

  if ("error" in result) {
    return json({ error: result.error }, result.status as number);
  }

  // Metadata only — never echo the content back.
  const metadata: Record<string, unknown> = { ...result };
  delete metadata.content;
  delete metadata.blob_key;
  return json(metadata, 200);
}

export async function GET(req: Request, ctx: Ctx) {
  const auth = await authenticate(req);
  if (!auth) return unauthorized();

  const { slug, path } = await ctx.params;
  const result = await getFile(slug, auth.userId, path.join("/"));

  if (!result) return json({ error: "Collection not found" }, 404);
  if ("error" in result) {
    return json({ error: result.error }, result.status as number);
  }

  // Blob tier: ALWAYS redirect to the presigned URL — no byte-streaming path.
  if ("download_url" in result) {
    return new Response(null, {
      status: 302,
      headers: { Location: result.download_url },
    });
  }

  return new Response(result.content, {
    status: 200,
    headers: { "Content-Type": result.mime_type },
  });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const auth = await authenticate(req);
  if (!auth) return unauthorized();

  const { slug, path } = await ctx.params;
  const result = await deleteFile(slug, auth.userId, path.join("/"));

  if (!result) return json({ error: "Collection not found" }, 404);
  if ("error" in result) {
    return json({ error: result.error }, result.status as number);
  }

  return json(result, 200);
}
