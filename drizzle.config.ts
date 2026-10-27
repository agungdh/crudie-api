import { existsSync, readFileSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit runs on Node (not in the Worker), so it reads env from `.env`
 * or, as a convenience, from `.dev.vars` (the file `wrangler dev` uses).
 */
function loadLocalEnv() {
  for (const file of [".env", ".dev.vars"]) {
    if (!existsSync(file)) continue;

    for (const line of readFileSync(file, "utf8").split("\n")) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
      if (!match) continue;

      const [, key, raw] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = raw.replace(/^(['"])(.*)\1$/, "$2");
    }
  }
}

loadLocalEnv();

// Migrations use a session/direct connection: PgBouncer transaction mode
// (port 6543) cannot hold the locks/state drizzle-kit needs.
const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL ?? "";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
  verbose: true,
  strict: true,
});
