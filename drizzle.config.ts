import { defineConfig } from "drizzle-kit";
import { loadLocalEnv } from "./src/db/env";

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
