import { Hono } from "hono";
import { createR2, R2Error } from "../lib/r2";

export type FileEnv = {
  Bindings: CloudflareBindings;
};

export const filesRoute = new Hono<FileEnv>();

filesRoute.onError((err, c) => {
  if (err instanceof R2Error) {
    return c.json({ error: "Storage error", operation: err.operation, detail: err.detail }, 502);
  }
  throw err;
});

/** Upload (or overwrite) an object. Body is streamed straight to R2. */
filesRoute.put("/:key{.+}", async (c) => {
  const key = c.req.param("key");
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: "Body is required" }, 400);

  const r2 = createR2(c.env);
  const result = await r2.put(key, body, {
    contentType: c.req.header("content-type") ?? "application/octet-stream",
    cacheControl: c.req.header("cache-control") ?? undefined,
  });

  return c.json({ data: result }, 201);
});

/** Download an object, honouring `If-None-Match`. */
filesRoute.get("/:key{.+}", async (c) => {
  const key = c.req.param("key");
  const r2 = createR2(c.env);

  const exists = await r2.head(key);
  if (!exists) return c.json({ error: "Not found" }, 404);

  if (exists.etag && c.req.header("if-none-match") === exists.etag) {
    return new Response(null, { status: 304, headers: { etag: exists.etag } });
  }

  const object = await r2.get(key);
  if (!object) return c.json({ error: "Not found" }, 404);

  const headers = new Headers({ "content-type": object.contentType ?? "application/octet-stream" });
  if (object.etag) headers.set("etag", object.etag);
  if (object.size) headers.set("content-length", String(object.size));

  return new Response(object.body, { headers });
});

filesRoute.delete("/:key{.+}", async (c) => {
  const key = c.req.param("key");
  const r2 = createR2(c.env);

  await r2.delete(key);
  return c.body(null, 204);
});

/** Presigned URL so the browser can upload/download without going through the Worker. */
filesRoute.post("/:key{.+}/presign", async (c) => {
  const key = c.req.param("key");
  const method = (c.req.query("method") ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "PUT" && method !== "DELETE") {
    return c.json({ error: "method must be GET, PUT or DELETE" }, 400);
  }

  const expiresIn = Number(c.req.query("expires") ?? 3600);
  const r2 = createR2(c.env);

  try {
    const url = await r2.presign(key, { method, expiresIn });
    return c.json({ data: { url, method, expiresIn } });
  } catch (err) {
    if (err instanceof RangeError) return c.json({ error: err.message }, 400);
    throw err;
  }
});
