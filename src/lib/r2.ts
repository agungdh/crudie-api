import { AwsClient } from "aws4fetch";

export interface R2Binding {
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET: string;
}

export interface R2Object {
  body: ReadableStream;
  contentType: string | null;
  etag: string | null;
  size: number | null;
}

export interface PutOptions {
  contentType?: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
}

export interface PresignOptions {
  method?: "GET" | "PUT" | "DELETE";
  expiresIn?: number;
}

export class R2Error extends Error {
  constructor(
    readonly operation: string,
    readonly key: string,
    readonly status: number,
    readonly detail: string,
  ) {
    super(`R2 ${operation} failed for "${key}" (${status})`);
    this.name = "R2Error";
  }
}

/**
 * Minimal S3 client for Cloudflare R2, signed with aws4fetch.
 * Works in Workers out of the box (no S3 SDK, no node built-ins).
 */
export function createR2(env: R2Binding) {
  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  });

  const endpoint = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}`;

  const objectUrl = (key: string) =>
    `${endpoint}/${key.replace(/^\/+/, "")}`;

  async function assertOk(operation: string, key: string, res: Response) {
    if (res.ok) return;
    throw new R2Error(
      operation,
      key,
      res.status,
      (await res.text().catch(() => "")).slice(0, 500),
    );
  }

  return {
    async put(
      key: string,
      body: Blob | ArrayBuffer | ArrayBufferView | ReadableStream | string,
      options: PutOptions = {},
    ) {
      const headers = new Headers();
      if (options.contentType) headers.set("content-type", options.contentType);
      if (options.cacheControl) headers.set("cache-control", options.cacheControl);
      for (const [name, value] of Object.entries(options.metadata ?? {})) {
        headers.set(`x-amz-meta-${name}`, value);
      }

      const res = await client.fetch(objectUrl(key), {
        method: "PUT",
        body,
        headers,
      });
      await assertOk("put", key, res);

      return { key, etag: res.headers.get("etag") };
    },

    async get(key: string, headers?: HeadersInit): Promise<R2Object | null> {
      const res = await client.fetch(objectUrl(key), { headers });
      if (res.status === 404) return null;
      await assertOk("get", key, res);

      return {
        body: res.body as ReadableStream,
        contentType: res.headers.get("content-type"),
        etag: res.headers.get("etag"),
        size: Number(res.headers.get("content-length")) || null,
      };
    },

    async head(key: string, headers?: HeadersInit) {
      const res = await client.fetch(objectUrl(key), { method: "HEAD", headers });
      if (res.status === 404) return null;
      await assertOk("head", key, res);

      return {
        contentType: res.headers.get("content-type"),
        etag: res.headers.get("etag"),
        size: Number(res.headers.get("content-length")) || null,
        lastModified: res.headers.get("last-modified"),
      };
    },

    async delete(key: string) {
      const res = await client.fetch(objectUrl(key), { method: "DELETE" });
      if (res.status !== 404) await assertOk("delete", key, res);
    },

    /** Returns the raw S3 ListObjectsV2 XML payload. */
    async list(prefix = "", { max = 1000, cursor }: { max?: number; cursor?: string } = {}) {
      const params = new URLSearchParams({
        "list-type": "2",
        prefix,
        "max-keys": String(max),
      });
      if (cursor) params.set("continuation-token", cursor);

      const res = await client.fetch(`${endpoint}?${params}`);
      await assertOk("list", prefix, res);

      return {
        xml: await res.text(),
        truncated: res.headers.get("x-amz-truncated") === "true",
        nextCursor: res.headers.get("x-amz-next-continuation-token"),
      };
    },

    /** Time-limited URL, e.g. for direct browser upload/download. */
    async presign(key: string, { method = "GET", expiresIn = 3600 }: PresignOptions = {}) {
      if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > 604800) {
        throw new RangeError("expiresIn must be an integer between 1 and 604800");
      }

      // aws4fetch reads X-Amz-Expires from the query string and defaults to
      // 86400 when absent, so it has to be set on the URL before signing.
      const target = `${objectUrl(key)}?X-Amz-Expires=${expiresIn}`;
      const signed = await client.sign(target, {
        method,
        aws: { signQuery: true },
      });

      return signed.url;
    },
  };
}

export type R2 = ReturnType<typeof createR2>;
