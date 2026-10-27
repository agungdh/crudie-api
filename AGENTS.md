# AGENTS.md

Single Cloudflare Worker: a [Hono](https://hono.dev) API (`src/index.ts`) plus static assets in `public/`. No framework build step — Wrangler bundles `src/index.ts` directly.

## Commands

- `npm install` — npm is the documented manager; `package-lock.json` is tracked even though `.gitignore` lists it.
- `npm run dev` — `wrangler dev`, local server at http://localhost:8787 (uses `.wrangler/` state, no Cloudflare login needed).
- `npm run deploy` — `wrangler deploy --minify`; needs Cloudflare auth (`wrangler login` or `CLOUDFLARE_API_TOKEN`).
- `npm run cf-typegen` — regenerate `worker-configuration.d.ts` after changing bindings/vars in `wrangler.jsonc`.

There is no lint, test, or typecheck script. TypeScript is not a dependency, so `npx tsc --noEmit` fails with "this is not the tsc command"; use `npx wrangler deploy --dry-run` as the fastest build/verification check. There is no CI.

## Conventions & gotchas

- `worker-configuration.d.ts` is generated — never hand-edit. Add bindings/vars/secrets in `wrangler.jsonc` (JSONC, comments allowed), then run `npm run cf-typegen`. `CloudflareBindings` is a global interface used as the Hono generic: `new Hono<{ Bindings: CloudflareBindings }>()`.
- Entrypoint uses Workers module syntax: `export default app` (no `serve()` call, no Node server).
- `public/` is served as static assets through the `ASSETS` binding before the Worker runs; only unmatched paths (e.g. `/message`) reach Hono. `public/index.html` is the demo page calling `/message`.
- JSX/TSX is preconfigured (`hono/jsx` via `tsconfig.json`), so `.tsx` route files work without extra setup.
- Local secrets/vars go in `.dev.vars` (gitignored); production secrets via `wrangler secret put`.
- `compatibility_date` in `wrangler.jsonc` is pinned to the workerd types used by `worker-configuration.d.ts`; don't bump it casually.
- `pnpm-workspace.yaml` only whitelists `esbuild`/`workerd` install scripts — there is no pnpm lockfile, and the repo is not a workspace.
