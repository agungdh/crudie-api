import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../db/middleware";

/**
 * Used when `CORS_ORIGINS` is unset: the local Angular dev server.
 * Override with a comma-separated list, e.g. `CORS_ORIGINS="https://app.example.com"`.
 * A literal `*` allows every origin (only safe without credentials).
 */
const DEFAULT_ORIGINS = ["http://localhost:4200"];

function resolveOrigins(env: CloudflareBindings) {
  const configured = env.CORS_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return configured?.length ? configured : DEFAULT_ORIGINS;
}

/**
 * CORS for the API. Reads `CORS_ORIGINS` per request (Workers cannot share
 * module-scope state), so the same deployment can be reconfigured without a
 * code change. Requests from unknown origins are not rejected — they simply
 * get no CORS headers, which is what browsers enforce.
 */
export const corsMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const origins = resolveOrigins(c.env);
  const allowAll = origins.includes("*");

  return cors({
    origin: (origin) =>
      allowAll || origins.includes(origin) ? origin : undefined,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86_400,
  })(c, next);
});
