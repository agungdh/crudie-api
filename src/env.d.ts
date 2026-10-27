/**
 * Secrets are not part of the generated `worker-configuration.d.ts`
 * (`npm run cf-typegen` only sees `vars`), so they are declared here.
 */
declare global {
  interface CloudflareBindings {
    /** Supabase connection string — use the transaction pooler (port 6543). */
    DATABASE_URL: string;
    /** S3-compatible storage (R2, AWS S3, MinIO, Supabase, ...). */
    S3_ENDPOINT: string;
    S3_REGION: string;
    S3_BUCKET: string;
    S3_ACCESS_KEY_ID: string;
    S3_SECRET_ACCESS_KEY: string;
    S3_FORCE_PATH_STYLE: string;
    /**
     * Comma-separated CORS allowlist. Optional — defaults to
     * `http://localhost:4200` (Angular dev server) when unset.
     */
    CORS_ORIGINS?: string;
  }
}

export {};
