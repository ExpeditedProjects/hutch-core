import { AwsClient } from "aws4fetch";

// The ONLY place blob storage lives (mirrors src/lib/auth/seam.ts). Signs
// SigV4 requests via aws4fetch against any S3-compatible endpoint (AWS S3,
// MinIO, R2, Tigris, ...), configured entirely by env:
//
//   HUTCH_S3_ENDPOINT           e.g. https://s3.amazonaws.com or http://127.0.0.1:9010
//   HUTCH_S3_BUCKET
//   HUTCH_S3_ACCESS_KEY_ID
//   HUTCH_S3_SECRET_ACCESS_KEY
//   HUTCH_S3_REGION             optional (default us-east-1; "auto" for R2/MinIO)
//
// When the env vars are absent every op rejects with a clear "storage not
// configured" error — callers (the files service) surface it as HTTP 501.

export interface Storage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  delete(keys: string[]): Promise<void>;
  /** Time-limited presigned GET URL — local crypto, no network call. */
  getDownloadUrl(key: string): Promise<string>;
}

const DOWNLOAD_URL_EXPIRES_SECONDS = 900; // 15 minutes

type StorageConfig = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
};

// Read at call time (not module scope) so env changes are always honored.
function readConfig(): StorageConfig | null {
  const endpoint = process.env.HUTCH_S3_ENDPOINT;
  const bucket = process.env.HUTCH_S3_BUCKET;
  const accessKeyId = process.env.HUTCH_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.HUTCH_S3_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    endpoint: endpoint.replace(/\/+$/, ""),
    bucket,
    accessKeyId,
    secretAccessKey,
    region: process.env.HUTCH_S3_REGION || "us-east-1",
  };
}

function requireConfig(): StorageConfig {
  const config = readConfig();
  if (!config) {
    throw new Error(
      "Blob storage is not configured. Set the HUTCH_S3_* environment variables."
    );
  }
  return config;
}

// Keys never escape the bucket: relative, non-empty, no '..' segments.
function validateKey(key: string): string {
  if (!key || key.startsWith("/") || key.includes("\0")) {
    throw new Error(`Invalid storage key: ${JSON.stringify(key)}`);
  }
  if (key.split("/").some((segment) => segment === "..")) {
    throw new Error(`Invalid storage key: ${JSON.stringify(key)}`);
  }
  return key;
}

function clientFor(config: StorageConfig): AwsClient {
  return new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: config.region,
  });
}

function objectUrl(config: StorageConfig, key: string): string {
  return `${config.endpoint}/${config.bucket}/${key}`;
}

export function getStorage(): Storage {
  return {
    async put(key, bytes, contentType) {
      const config = requireConfig();
      validateKey(key);
      const client = clientFor(config);
      const res = await client.fetch(objectUrl(config, key), {
        method: "PUT",
        // Copy into a fresh ArrayBuffer-backed body (Uint8Array may be a view).
        body: new Uint8Array(bytes),
        headers: { "Content-Type": contentType },
      });
      if (!res.ok) {
        throw new Error(`Blob storage PUT failed with status ${res.status}`);
      }
    },

    async delete(keys) {
      const config = requireConfig();
      for (const key of keys) validateKey(key);
      const client = clientFor(config);
      await Promise.all(
        keys.map(async (key) => {
          const res = await client.fetch(objectUrl(config, key), { method: "DELETE" });
          // 404 = already gone — deletion is idempotent.
          if (!res.ok && res.status !== 404) {
            throw new Error(`Blob storage DELETE failed with status ${res.status}`);
          }
        })
      );
    },

    async getDownloadUrl(key) {
      const config = requireConfig();
      validateKey(key);
      const client = clientFor(config);
      const url = new URL(objectUrl(config, key));
      url.searchParams.set("X-Amz-Expires", String(DOWNLOAD_URL_EXPIRES_SECONDS));
      const signed = await client.sign(new Request(url, { method: "GET" }), {
        aws: { signQuery: true },
      });
      return signed.url;
    },
  };
}
