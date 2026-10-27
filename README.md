# crudie-api

Hono API on Cloudflare Workers, with Supabase Postgres (Drizzle ORM) and
Cloudflare R2 storage (aws4fetch).

```txt
npm install
cp .dev.vars.example .dev.vars   # lalu isi kredensialnya
npm run db:migrate               # buat tabel di Supabase
npm run dev                      # http://localhost:8787
```

```txt
npm run deploy
```

## Database (Supabase + Drizzle)

Schema ada di `src/db/schema.ts` (saat ini tabel `notes`). Query pakai query
builder Drizzle lewat `c.get("db")` — klien dibuat per request di
`src/db/middleware.ts` supaya koneksi tidak dipakai ulang antar request.

Dua connection string dipakai:

| Env | Port | Dipakai oleh |
| --- | --- | --- |
| `DATABASE_URL` | **6543** (transaction pooler) | Worker (`src/db/index.ts`) |
| `DATABASE_URL_DIRECT` | **5432** (session mode) | `drizzle-kit` migrate/push/studio |

Transaction pooler (PgBouncer) tidak mendukung prepared statement, jadi
`postgres(..., { prepare: false })` wajib. Migrasi sebaiknya lewat session
mode karena butuh session state/lock.

Format URL Supabase (`<ref>` = project ref, ambil di Dashboard → Connect):

```txt
postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?sslmode=require
```

Perintah:

```txt
npm run db:generate   # bikin SQL dari perubahan src/db/schema.ts -> drizzle/
npm run db:migrate    # jalankan migrasi
npm run db:push       # sync schema tanpa file migrasi (prototyping)
npm run db:studio     # Drizzle Studio
```

`drizzle-kit` membaca `.env` atau `.dev.vars` (lihat `drizzle.config.ts`), jadi
cukup satu tempat untuk lokal.

## Storage (R2 + aws4fetch)

`src/lib/r2.ts` adalah klien S3 minimal (tanpa AWS SDK), dipakai di
`src/routes/files.ts`. Buat bucket dulu, lalu buat R2 API token dengan
permission *Object Read & Write* untuk bucket tersebut.

Secrets yang dibutuhkan: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.

## Endpoints

```txt
GET    /message                      health check

GET    /api/notes                    list (100 terbaru)
POST   /api/notes                    { "title": "...", "content": "..." }
GET    /api/notes/:id
PATCH  /api/notes/:id
DELETE /api/notes/:id

PUT    /api/files/:key               upload (raw body, content-type dipakai)
GET    /api/files/:key               download (mendukung If-None-Match)
DELETE /api/files/:key
POST   /api/files/:key/presign?method=PUT&expires=600
```

Semua error dikembalikan sebagai JSON `{ "error": "..." }`.

## Deploy

```txt
wrangler secret put DATABASE_URL
wrangler secret put R2_ACCOUNT_ID
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
wrangler secret put R2_BUCKET
npm run deploy
```

## Types

`worker-configuration.d.ts` di-generate; secret dideklarasikan manual di
`src/env.d.ts`.

```txt
npm run cf-typegen
```
