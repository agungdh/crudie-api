# crudie-api

Hono API on Cloudflare Workers, with Supabase Postgres (Drizzle ORM) and
S3-compatible object storage (aws4fetch).

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

## Storage (S3-compatible + aws4fetch)

`src/lib/s3.ts` adalah klien S3 minimal (tanpa AWS SDK), dipakai di
`src/routes/files.ts`. Karena cuma butuh endpoint + kredensial S3, vendor bisa
diganti tanpa ubah kode: Cloudflare R2, AWS S3, MinIO, Supabase Storage,
Backblaze B2, Wasabi, dan lainnya.

Secrets yang dibutuhkan:

| Env | Keterangan |
| --- | --- |
| `S3_ENDPOINT` | Base URL **tanpa** nama bucket |
| `S3_REGION` | `auto` untuk R2, region asli untuk AWS/MinIO |
| `S3_BUCKET` | Nama bucket |
| `S3_ACCESS_KEY_ID` | Access key |
| `S3_SECRET_ACCESS_KEY` | Secret key |
| `S3_FORCE_PATH_STYLE` | `true` (default) atau `false` untuk virtual-hosted style |

Contoh `S3_ENDPOINT`:

```txt
R2        https://<account-id>.r2.cloudflarestorage.com
AWS       https://s3.<region>.amazonaws.com
MinIO     http://localhost:9000
Supabase  https://<project-ref>.storage.supabase.co/storage/v1/s3
```

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
wrangler secret put S3_ENDPOINT
wrangler secret put S3_REGION
wrangler secret put S3_BUCKET
wrangler secret put S3_ACCESS_KEY_ID
wrangler secret put S3_SECRET_ACCESS_KEY
wrangler secret put S3_FORCE_PATH_STYLE
npm run deploy
```

## Types

`worker-configuration.d.ts` di-generate; secret dideklarasikan manual di
`src/env.d.ts`.

```txt
npm run cf-typegen
```
