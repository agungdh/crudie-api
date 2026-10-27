# AGENTS.md

Single Cloudflare Worker: a [Hono](https://hono.dev) API (`src/index.ts`) plus static assets in `public/`. No framework build step — Wrangler bundles `src/index.ts` directly.

Postgres only — no D1, no KV. Local dev runs the database in Docker; production is any hosted Postgres reached through a pooler (Supabase / PgBouncer).

## Commands

- `docker compose up -d` — local Postgres 17 (and Adminer at http://localhost:8083) from `compose.yml`. MinIO will be added to the same compose file later; S3 storage is not wired up locally yet.
- `npm install` — npm is the documented manager; `package-lock.json` is tracked even though `.gitignore` lists it.
- `npm run dev` — `wrangler dev`, local server at http://localhost:8787 (uses `.wrangler/` state, no Cloudflare login needed).
- `npm run deploy` — `wrangler deploy --minify`; needs Cloudflare auth (`wrangler login` or `CLOUDFLARE_API_TOKEN`).
- `npm run cf-typegen` — regenerate `worker-configuration.d.ts` after changing bindings/vars in `wrangler.jsonc`.
- `npm run db:generate` / `db:migrate` / `db:push` / `db:studio` — Drizzle Kit against `src/db/schema.ts`; SQL migrations live in `drizzle/` and are committed.

There is no lint, test, or typecheck script. TypeScript is not a dependency, so `npx tsc --noEmit` fails with "this is not the tsc command"; use `npx wrangler deploy --dry-run` as the fastest build/verification check. There is no CI.

## List endpoints: cursor pagination

Every list endpoint is keyset/cursor paginated. No `offset`, no `total` count query.

- Cursor is `?after=<uuid>` — the `uuid` (never the internal integer `id`) of the **last row of the previous page**. Omit it for the first page.
- Response shape is `{ data: [...], meta: { nextCursor } }`, where `nextCursor` is the uuid of the last row on the page, or `null` once there are no more rows. To decide, fetch `limit + 1` rows and drop the extra one. `limit` stays a capped query param (default 20, max 100).
- Filters and sort are **their own plain query params**, never packed/encoded/signed into the cursor. The cursor is a bare uuid so it stays readable and debuggable: `?status=aktif&q=budi&sort=nama&order=asc&after=<uuid>`.
- Because the cursor carries no state, the client must resend the same filters/sort on every page. Changing a filter or the sort restarts pagination (drop `after`); the server cannot know the cursor was produced under different criteria, so the client owns keeping them stable.
- Sort is `?sort=<field>&order=asc|desc`, whitelisted per endpoint (unknown field/order → 400). **Default when `sort` is absent: `id desc`** (newest first). Always append `id` as the final, same-direction tiebreaker so the ordering is total and the cursor cannot skip or repeat rows.
- Query pattern: resolve the cursor row to its sort value + `id`, then `WHERE (sortValue, id) < (cursorValue, cursorId)` (`>` for `asc`), combined with the filter conditions and `deleted_at is null`, ordered by `sort, id` in the requested direction.
- `src/routes/pegawai.ts` is the reference implementation: it resolves `after` to `(sortValue, id)`, compares the row tuple against it, and returns `nextCursor` from a `limit + 1` fetch.

## Conventions & gotchas

- `worker-configuration.d.ts` is generated — never hand-edit. Add bindings/vars/secrets in `wrangler.jsonc` (JSONC, comments allowed), then run `npm run cf-typegen`. `CloudflareBindings` is a global interface used as the Hono generic: `new Hono<{ Bindings: CloudflareBindings }>()`.
- Entrypoint uses Workers module syntax: `export default app` (no `serve()` call, no Node server).
- `public/` is served as static assets through the `ASSETS` binding before the Worker runs; only unmatched paths (e.g. `/message`) reach Hono. `public/index.html` is the demo page calling `/message`.
- JSX/TSX is preconfigured (`hono/jsx` via `tsconfig.json`), so `.tsx` route files work without extra setup.
- Local secrets/vars go in `.dev.vars` (gitignored); production secrets via `wrangler secret put`.
- `compatibility_date` in `wrangler.jsonc` is pinned to the workerd types used by `worker-configuration.d.ts`; don't bump it casually.
- Node.js compat is implicit, not configured: with `compatibility_date` >= `2026-08-04` Workers enables `nodejs_compat`/`nodejs_compat_v2` by default. That is what lets `postgres` import `node:net`/`node:tls` (mapped to `cloudflare:sockets`) to reach a hosted Postgres — so no `compatibility_flags` entry is needed. If the compatibility date is ever moved before `2026-08-04`, add `"compatibility_flags": ["nodejs_compat"]` back.
- DB: `postgres-js` + Drizzle, plain Postgres connection string — no D1/`@cloudflare/d1`. `DATABASE_URL` points at the **pooled** endpoint: local Docker Postgres in dev (`postgresql://admin:admin@localhost:5432/crudie`), and on deploy a PgBouncer-family pooler (Supabase transaction pooler on port 6543, or whatever the host offers). Transaction pooling does not support prepared statements, so `prepare: false` in `src/db/index.ts` is mandatory and must not be "optimized" away — it is also harmless on the direct local connection. Never hoist the client to module scope: Workers cannot reuse sockets across requests, so `src/db/middleware.ts` creates it per request and closes it with `ctx.waitUntil`. `DATABASE_URL_DIRECT` (session/direct connection, port 5432) is only used by `drizzle.config.ts` for migrations — PgBouncer transaction mode cannot hold the session state/locks they need. Locally both can be the same URL.
- IDs: every table's primary key is `id`, an **integer** `generated always as identity` column — `integer("id").primaryKey().generatedAlwaysAsIdentity()`, not `serial`. Integer ids are internal only and must never leave the Worker. Anything reachable from the frontend also carries a `uuid` uuidv4 column — `uuid("uuid").notNull().defaultRandom()` (Postgres `gen_random_uuid()`) — and that uuid is the only identifier the API exposes — indexed with a **non-unique hash index**, not a unique constraint (see below). Purely internal tables (e.g. join tables, which use a composite integer PK) can skip it.
- Foreign keys use the internal integer id and keep the `_id` suffix: `user_id`, `category_id`, … via `references(() => users.id)` (singular relation name, plural table). `*_id` columns are never returned; serialize them to `<relation>_uuid` (e.g. `user_uuid`) at the route/serializer boundary, joining to resolve the uuid.
- Schema conventions: every table spreads `auditColumns()` from `src/db/schema.ts` — `created_at` / `updated_at` / `deleted_at` (`timestamptz`) and `created_by` / `updated_by` / `deleted_by` (`integer`, same type as `users.id`; they store internal ids, so they are not part of the public response either). All six are nullable and default-less (no `notNull()`, no `defaultNow()`), and intentionally carry no indexes or FKs. Deletes are soft, so unique constraints must use `partialLowerUniqueIndex(name, column, deletedAt)` — `uniqueIndex(name).on(lower(column)).where(deleted_at is null)` — never a plain unique index, and always `lower()`, since Postgres text comparison is case-sensitive. The `uuid` column is the other exception: never mark it `.unique()` or give it a `uniqueIndex`; index it with a plain, **non-unique hash index** — `index("users_uuid_idx").using("hash", t.uuid)` inside the `pgTable` callback, named `<table>_uuid_idx`. Uniqueness is already guaranteed by `gen_random_uuid()`, so a unique constraint only adds write cost and index bloat, and a soft delete would make a plain unique constraint awkward anyway. Hash is preferred over the default btree because uuid lookups (and joins resolving `<relation>_uuid`) are equality-only, and hash indexes are smaller and cheaper to maintain.
- Secrets are not visible to `npm run cf-typegen`; declare them by augmenting `CloudflareBindings` in `src/env.d.ts`.
- Storage uses `aws4fetch` (S3 SigV4) in `src/lib/s3.ts` — no AWS SDK, no R2 binding, and no R2-specific code. It talks to any S3-compatible vendor (R2, AWS S3, MinIO, Supabase, B2, Wasabi) via `S3_ENDPOINT` + `S3_REGION` + `S3_BUCKET` + credentials, with path style by default (`S3_FORCE_PATH_STYLE=false` for virtual-hosted style). MinIO is planned as a compose service for local storage, but is not in `compose.yml` yet — don't add MinIO-specific code paths, the generic S3 client must stay vendor-neutral.
- `pnpm-workspace.yaml` only whitelists `esbuild`/`workerd` install scripts — there is no pnpm lockfile, and the repo is not a workspace.
