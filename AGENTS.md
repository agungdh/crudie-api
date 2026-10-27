# AGENTS.md

Single Cloudflare Worker: a [Hono](https://hono.dev) API (`src/index.ts`) plus static assets in `public/`. No framework build step — Wrangler bundles `src/index.ts` directly.

## Commands

- `npm install` — npm is the documented manager; `package-lock.json` is tracked even though `.gitignore` lists it.
- `npm run dev` — `wrangler dev`, local server at http://localhost:8787 (uses `.wrangler/` state, no Cloudflare login needed).
- `npm run deploy` — `wrangler deploy --minify`; needs Cloudflare auth (`wrangler login` or `CLOUDFLARE_API_TOKEN`).
- `npm run cf-typegen` — regenerate `worker-configuration.d.ts` after changing bindings/vars in `wrangler.jsonc`.
- `npm run db:generate` / `db:migrate` / `db:push` / `db:studio` — Drizzle Kit against `src/db/schema.ts`; SQL migrations live in `drizzle/` and are committed.

There is no lint, test, or typecheck script. TypeScript is not a dependency, so `npx tsc --noEmit` fails with "this is not the tsc command"; use `npx wrangler deploy --dry-run` as the fastest build/verification check. There is no CI.

## Conventions & gotchas

- `worker-configuration.d.ts` is generated — never hand-edit. Add bindings/vars/secrets in `wrangler.jsonc` (JSONC, comments allowed), then run `npm run cf-typegen`. `CloudflareBindings` is a global interface used as the Hono generic: `new Hono<{ Bindings: CloudflareBindings }>()`.
- Entrypoint uses Workers module syntax: `export default app` (no `serve()` call, no Node server).
- `public/` is served as static assets through the `ASSETS` binding before the Worker runs; only unmatched paths (e.g. `/message`) reach Hono. `public/index.html` is the demo page calling `/message`.
- JSX/TSX is preconfigured (`hono/jsx` via `tsconfig.json`), so `.tsx` route files work without extra setup.
- Local secrets/vars go in `.dev.vars` (gitignored); production secrets via `wrangler secret put`.
- `compatibility_date` in `wrangler.jsonc` is pinned to the workerd types used by `worker-configuration.d.ts`; don't bump it casually.
- Node.js compat is implicit, not configured: with `compatibility_date` >= `2026-08-04` Workers enables `nodejs_compat`/`nodejs_compat_v2` by default. That is what lets `postgres` import `node:net`/`node:tls` (mapped to `cloudflare:sockets`) to reach Supabase — so no `compatibility_flags` entry is needed. If the compatibility date is ever moved before `2026-08-04`, add `"compatibility_flags": ["nodejs_compat"]` back.
- DB: `DATABASE_URL` must point at the Supabase **transaction pooler** (port 6543), which is why `postgres()` is created with `prepare: false`. Never hoist the client to module scope — Workers cannot reuse sockets across requests, so `src/db/middleware.ts` creates it per request and closes it with `ctx.waitUntil`. `DATABASE_URL_DIRECT` (port 5432, session mode) is only used by `drizzle.config.ts` for migrations.
- Secrets are not visible to `npm run cf-typegen`; declare them by augmenting `CloudflareBindings` in `src/env.d.ts`.
- Storage uses `aws4fetch` (S3 SigV4) in `src/lib/s3.ts` — no AWS SDK, no R2 binding, and no R2-specific code. It talks to any S3-compatible vendor (R2, AWS S3, MinIO, Supabase, B2, Wasabi) via `S3_ENDPOINT` + `S3_REGION` + `S3_BUCKET` + credentials, with path style by default (`S3_FORCE_PATH_STYLE=false` for virtual-hosted style).
- `pnpm-workspace.yaml` only whitelists `esbuild`/`workerd` install scripts — there is no pnpm lockfile, and the repo is not a workspace.
