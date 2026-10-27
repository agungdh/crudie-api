import { AwsClient } from "aws4fetch";

/**
 * Any S3-compatible object storage: Cloudflare R2, AWS S3, MinIO,
 * Backblaze B2, Supabase Storage, Wasabi, etc.
 */
export interface S3Config {
  /**
   * Base endpoint **without** the bucket name. R2 uses
   * `https://<account>.r2.cloudflarestorage.com`; AWS uses
   * `https://s3.<region>.amazonaws.com`; MinIO uses `http://localhost:9000`.
   */
  S3_ENDPOINT: string;
  S3_BUCKET: string;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
  /** SigV4 region. R2 uses `auto`; AWS/MinIO expect the real region. */
  S3_REGION?: string;
  /** `"false"` switches to virtual-hosted style (`<bucket>.<host>`). Defaults to path style. */
  S3_FORCE_PATH_STYLE?: string;
}

export interface S3Object {
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

export class S3Error extends Error {
  constructor(
    readonly operation: string,
    readonly key: string,
    readonly status: number,
    readonly detail: string,
  ) {
    super(`S3 ${operation} failed for "${key}" (${status})`);
    this.name = "S3Error";
  }
}

/** Reads the first `<tag>…</tag>` text node from an S3 XML response. */
function xmlValue(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match?.[1] ?? null;
}

/**
 * Minimal S3 client signed with aws4fetch.
 * Works in Workers out of the box (no S3 SDK, no node built-ins).
 */
export function createS3(env: S3Config) {
  const client = new AwsClient({
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    service: "s3",
    region: env.S3_REGION || "auto",
  });

  const base = env.S3_ENDPOINT.replace(/\/+$/, "");
  const bucket = env.S3_BUCKET;
  const pathStyle = env.S3_FORCE_PATH_STYLE !== "false";

  // Path style: https://host/<bucket>/<key> (R2, MinIO, Supabase, ...).
  // Virtual-hosted: https://<bucket>.host/<key> (AWS default).
  const endpoint = pathStyle
    ? `${base}/${bucket}`
    : (() => {
        const url = new URL(base);
        url.hostname = `${bucket}.${url.hostname}`;
        return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
      })();

  const objectUrl = (key: string) =>
    `${endpoint}/${key.replace(/^\/+/, "")}`;

  async function assertOk(operation: string, key: string, res: Response) {
    if (res.ok) return;
    throw new S3Error(
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

    async get(key: string, headers?: HeadersInit): Promise<S3Object | null> {
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

      // Pagination lives in the XML body; S3 (and R2) set no x-amz-* headers here.
      const xml = await res.text();

      return {
        xml,
        truncated: xmlValue(xml, "IsTruncated") === "true",
        nextCursor: xmlValue(xml, "NextContinuationToken"),
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

export type S3 = ReturnType<typeof createS3>;
