/**
 * Secrets are not part of the generated `worker-configuration.d.ts`
 * (`npm run cf-typegen` only sees `vars`), so they are declared here.
 */
declare global {
  interface CloudflareBindings {
    /** Supabase connection string — use the transaction pooler (port 6543). */
    DATABASE_URL: string;
    R2_ACCOUNT_ID: string;
    R2_ACCESS_KEY_ID: string;
    R2_SECRET_ACCESS_KEY: string;
    R2_BUCKET: string;
  }
}

export {};
