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
  return Response.json(body, { status });
}

function unauthorized(): Response {
  return json({ error: "Unauthorized" }, 401);
}

// Cap request-body buffering at MAX_FILE_SIZE: reject on the declared
// Content-Length first, then abort mid-stream so a chunked upload can't
// buffer unbounded bytes before the size check. Returns null when over cap.
async function readBodyCapped(req: Request): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_FILE_SIZE) return null;

  if (!req.body) return new Uint8Array(await req.arrayBuffer());

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_FILE_SIZE) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function PUT(req: Request, ctx: Ctx) {
  const auth = await authenticate(req);
  if (!auth) return unauthorized();

  const { slug, path } = await ctx.params;
  const bytes = await readBodyCapped(req);

  if (bytes === null) {
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

  // nosniff + attachment: an attacker-chosen mime type (e.g. text/html) must
  // not render or execute in-browser on this origin.
  return new Response(result.content, {
    status: 200,
    headers: {
      "Content-Type": result.mime_type,
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "attachment",
    },
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
