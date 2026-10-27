import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDatabase>["db"];

/**
 * Supabase transaction pooler (port 6543) is PgBouncer in transaction mode:
 * prepared statements are not supported, so `prepare` must stay `false`.
 *
 * A new client is created per request because Workers cannot reuse I/O
 * objects (sockets) created in a previous request.
 */
export function createDatabase(connectionString: string) {
  const sql = postgres(connectionString, {
    prepare: false,
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    fetch_types: false,
  });

  const db = drizzle(sql, { schema });

  return {
    db,
    sql,
    close: () => sql.end({ timeout: 5 }),
  };
}
