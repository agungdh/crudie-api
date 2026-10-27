import { createMiddleware } from "hono/factory";
import { createDatabase, type Database } from "./index";

export type AppEnv = {
  Bindings: CloudflareBindings;
  Variables: {
    db: Database;
  };
};

/**
 * Opens a Supabase connection for the current request and closes it once the
 * response is flushed (`waitUntil`), so no socket is reused across requests.
 */
export const database = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }

  const connection = createDatabase(c.env.DATABASE_URL);
  c.set("db", connection.db);

  try {
    await next();
  } finally {
    try {
      c.executionCtx.waitUntil(connection.close());
    } catch {
      // No ExecutionContext (tests, local scripts): close eagerly.
      await connection.close();
    }
  }
});
