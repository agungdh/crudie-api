import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "./db/middleware";
import { corsMiddleware } from "./lib/cors";
import { pegawaiRoute } from "./routes/pegawai";
import { version } from "../package.json";

const app = new Hono<AppEnv>();

app.use("*", corsMiddleware);

app.get("/", (c) => c.json({ version }));

app.route("/api/pegawai", pegawaiRoute);

app.notFound((c) => c.json({ error: "Not found" }, 404));

/**
 * Every error response is JSON. `HTTPException` must be rethrown as-is (status
 * and message), otherwise the zod JSON validator's "Malformed JSON in request
 * body" would be reported as a 500.
 */
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message || "Request failed" }, err.status);
  }

  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
