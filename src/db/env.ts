import { existsSync, readFileSync } from "node:fs";

/**
 * drizzle-kit and the seed script run on Node (not in the Worker), so they read
 * env from `.env` or, as a convenience, from `.dev.vars` (the file
 * `wrangler dev` uses). Real process env always wins.
 */
export function loadLocalEnv() {
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
