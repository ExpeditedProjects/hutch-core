import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { records } from "@/lib/db/schema";
import { findCollectionByNameInOrg, findCollectionBySlugInOrg, findAccessibleCollectionBySlug, createCollectionWithOwner, notDeleted } from "@/lib/db/queries";
import { eq, and, sql } from "drizzle-orm";
import { getStorage } from "@/lib/storage/seam";
import { beforeStoreFile, releaseStorage } from "@/lib/quota";
import { createRecords } from "./records";
import { revalidateDashboard } from "@/lib/revalidation";
import { slugify, uniqueSlug, titleCase } from "@/lib/slugify";
import { MAX_INLINE_FILE_SIZE, MAX_FILE_SIZE } from "@/lib/constants";
import type { CollectionSchema } from "@/lib/schema-inference";

// Files stored as records. A file IS a record whose `data` has the canonical
// shape { path, filename, mime_type, size, content_hash, content? | blob_key? }.
//
// Two storage tiers:
//   INLINE — valid UTF-8, <= MAX_INLINE_FILE_SIZE, text-like mime → `content`
//            string inside the record JSON. Works without any storage config.
//   BLOB   — everything else, up to MAX_FILE_SIZE → bytes go through the
//            storage seam (src/lib/storage/seam.ts); the record stores
//            `blob_key`. Requires the HUTCH_S3_* env (else 501).

const MAX_PATH_LENGTH = 512;

type FileData = {
  path: string;
  filename: string;
  mime_type: string;
  size: number;
  content_hash: string;
  content?: string;
  blob_key?: string;
};

type FileMetadata = Omit<FileData, "content" | "blob_key">;

export type PutFileParams = {
  collection: string;
  path: string;
  content?: string;
  contentBase64?: string;
  mimeType?: string;
};

function isValidPath(path: string): boolean {
  if (!path || path.length > MAX_PATH_LENGTH) return false;
  if (path.startsWith("/") || path.includes("\0")) return false;
  if (path.split("/").some((segment) => segment === "..")) return false;
  return true;
}

function isTextLikeMime(mimeType: string | undefined): boolean {
  if (!mimeType) return true;
  return mimeType.startsWith("text/") || mimeType === "application/json";
}

function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function toMetadata(data: FileData): FileMetadata {
  return {
    path: data.path,
    filename: data.filename,
    mime_type: data.mime_type,
    size: data.size,
    content_hash: data.content_hash,
  };
}

// Preset schema for auto-created file collections — records upsert on path.
function fileCollectionSchema(): CollectionSchema {
  return {
    fields: [
      { name: "path", type: "text", inferred: false, position: 0, hidden: false },
      { name: "filename", type: "text", inferred: false, position: 1, hidden: false },
      { name: "mime_type", type: "text", inferred: false, position: 2, hidden: false },
      { name: "size", type: "number", inferred: false, position: 3, hidden: false },
      { name: "content_hash", type: "text", inferred: false, position: 4, hidden: true },
      { name: "content", type: "file", inferred: false, position: 5, hidden: false },
    ],
    version: 1,
    lastInferredAt: new Date().toISOString(),
  };
}

async function findFileRecord(collectionId: number, path: string) {
  const [existing] = await db
    .select()
    .from(records)
    .where(
      and(
        eq(records.collectionId, collectionId),
        sql`${records.data} @> ${JSON.stringify({ path })}::jsonb`,
        notDeleted
      )
    )
    .limit(1);
  return existing;
}

export async function putFile(userId: string, organizationId: string, params: PutFileParams) {
  const { collection: collectionName, path, content, contentBase64, mimeType } = params;

  if ((content === undefined) === (contentBase64 === undefined)) {
    return { error: "Provide exactly one of 'content' or 'content_base64'", status: 400 };
  }

  if (typeof path !== "string" || !isValidPath(path)) {
    return { error: "Invalid path: must be a relative path without '..' segments, under 513 characters", status: 400 };
  }

  const bytes: Uint8Array =
    content !== undefined
      ? new Uint8Array(Buffer.from(content, "utf8"))
      : new Uint8Array(Buffer.from(contentBase64!, "base64"));
  const size = bytes.byteLength;

  if (size > MAX_FILE_SIZE) {
    return { error: "File exceeds the 4MB size limit", status: 413 };
  }

  const inline =
    size <= MAX_INLINE_FILE_SIZE && isTextLikeMime(mimeType) && (content !== undefined || isValidUtf8(bytes));

  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const filename = path.split("/").pop()!;
  const mime = mimeType ?? (inline ? "text/plain" : "application/octet-stream");

  // Find or create the collection within the caller's org (mirrors createRecords).
  let collection = await findCollectionByNameInOrg(collectionName, organizationId);
  if (!collection) {
    collection = await findCollectionBySlugInOrg(slugify(collectionName), organizationId);
  }
  if (!collection) {
    collection = await createCollectionWithOwner({
      organizationId,
      ownerUserId: userId,
      name: titleCase(collectionName),
      slug: uniqueSlug(collectionName),
      uniqueKey: ["path"],
      schema: fileCollectionSchema(),
    });
  }

  // Snapshot the record being replaced (if any) so a superseded blob can be
  // cleaned up after the new version lands.
  const existing = await findFileRecord(collection.id, path);
  const existingData = existing?.data as FileData | undefined;

  const data: FileData = { path, filename, mime_type: mime, size, content_hash: contentHash };
  let newBlobKey: string | undefined;

  if (inline) {
    data.content = content !== undefined ? content : new TextDecoder("utf-8").decode(bytes);
  } else if (existingData?.blob_key && existingData.content_hash === contentHash) {
    // Same bytes already stored — reuse the blob, no rewrite, quota-neutral.
    data.blob_key = existingData.blob_key;
  } else {
    await beforeStoreFile({ userId, organizationId, bytes: size });
    newBlobKey = `blobs/${collection.id}/${nanoid()}`;
    try {
      await getStorage().put(newBlobKey, bytes, mime);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Blob storage write failed";
      if (/not configured/i.test(message)) {
        return { error: message, status: 501 };
      }
      return { error: "Failed to write file to blob storage", status: 502 };
    }
    data.blob_key = newBlobKey;
  }

  const result = await createRecords(userId, organizationId, {
    collection: collection.slug,
    data: data as unknown as Record<string, unknown>,
    on_conflict: "replace",
  });
  if (result && typeof result === "object" && "error" in result) {
    // The record write failed after a fresh blob landed — reap it and credit
    // the quota back so a rejected write can't leak storage.
    if (newBlobKey) {
      try {
        await getStorage().delete([newBlobKey]);
        await releaseStorage({ organizationId, bytes: size });
      } catch (err) {
        console.error("Failed to reap blob after record-write failure", newBlobKey, err);
      }
    }
    return result;
  }

  // The replaced version pointed at a different blob — delete it and credit
  // the storage back. Best-effort: an orphaned blob must not fail the write.
  if (existingData?.blob_key && existingData.content_hash !== contentHash) {
    try {
      await getStorage().delete([existingData.blob_key]);
      await releaseStorage({ organizationId, bytes: existingData.size });
    } catch (err) {
      console.error("Failed to delete superseded blob", existingData.blob_key, err);
    }
  }

  return toMetadata(data);
}

export async function getFile(slug: string, userId: string, path: string) {
  const access = await findAccessibleCollectionBySlug(slug, userId, "viewer");
  if (!access) return null;

  const record = await findFileRecord(access.collection.id, path);
  if (!record) return { error: "File not found", status: 404 };

  const data = record.data as FileData;
  if (data.content !== undefined) {
    return { ...toMetadata(data), content: data.content };
  }

  let downloadUrl: string;
  try {
    downloadUrl = await getStorage().getDownloadUrl(data.blob_key!);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Blob storage read failed";
    if (/not configured/i.test(message)) {
      return { error: message, status: 501 };
    }
    return { error: "Failed to resolve file download URL", status: 502 };
  }
  return { ...toMetadata(data), download_url: downloadUrl };
}

export async function listFiles(slug: string, userId: string) {
  const access = await findAccessibleCollectionBySlug(slug, userId, "viewer");
  if (!access) return null;

  const rows = await db
    .select()
    .from(records)
    .where(and(eq(records.collectionId, access.collection.id), notDeleted));

  const files = rows
    .map((row) => row.data as FileData)
    .filter((data) => data && typeof data.path === "string")
    .map(toMetadata)
    .sort((a, b) => a.path.localeCompare(b.path));

  return { files };
}

export async function deleteFile(slug: string, userId: string, path: string) {
  const access = await findAccessibleCollectionBySlug(slug, userId, "editor");
  if (!access) return null;

  const record = await findFileRecord(access.collection.id, path);
  if (!record) return { error: "File not found", status: 404 };

  // Soft delete only — the blob is RETAINED so the record stays restorable.
  // Blobs are reaped when the whole collection dies (cleanupCollectionBlobs).
  await db.update(records).set({ deletedAt: new Date() }).where(eq(records.id, record.id));
  revalidateDashboard(slug);
  return { deleted: true, path };
}

/**
 * Delete every blob belonging to a collection — including blobs referenced by
 * soft-deleted records. Called by deleteCollection BEFORE the hard row delete,
 * because the record rows (and their blob_keys) are gone once the collection
 * cascades away. Best-effort: storage failures must not block the delete.
 */
export async function cleanupCollectionBlobs(collectionId: number): Promise<void> {
  const rows = await db
    .select()
    .from(records)
    .where(eq(records.collectionId, collectionId));

  const keys = rows
    .map((row) => (row.data as FileData | null)?.blob_key)
    .filter((key): key is string => typeof key === "string");

  if (keys.length === 0) return;

  try {
    await getStorage().delete(keys);
  } catch (err) {
    console.error(`Failed to clean up ${keys.length} blob(s) for collection ${collectionId}`, err);
  }
}
