import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import type { z } from "zod";

/**
 * 400 body for every validation failure. `error` repeats the first issue so a
 * client that only reads `error` still gets a useful message; `issues` lists
 * every problem with a dotted path (`tanggalMasuk`, `email`, ...).
 */
function invalid(c: Context, error: z.core.$ZodError) {
  const issues = error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));

  return c.json(
    { error: issues[0]?.message ?? "Validation failed", issues },
    400,
  );
}

/**
 * Thin wrappers over `@hono/zod-validator` so every route validates the same
 * way and fails with the same JSON shape. Values are read back with
 * `c.req.valid("json" | "query" | "param")`.
 *
 * Note: the `json` target only parses requests with a JSON `Content-Type`; a
 * bodiless request is validated as `{}`, so required fields fail as usual.
 */
export const validateJson = <T extends z.ZodType>(schema: T) =>
  zValidator("json", schema, (result, c) => {
    if (!result.success) return invalid(c, result.error);
  });

export const validateQuery = <T extends z.ZodType>(schema: T) =>
  zValidator("query", schema, (result, c) => {
    if (!result.success) return invalid(c, result.error);
  });

export const validateParam = <T extends z.ZodType>(schema: T) =>
  zValidator("param", schema, (result, c) => {
    if (!result.success) return invalid(c, result.error);
  });
