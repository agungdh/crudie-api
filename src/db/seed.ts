import { reset, seed } from "drizzle-seed";
import { loadLocalEnv } from "./env";
import { createDatabase } from "./index";
import { pegawai } from "./schema";

loadLocalEnv();

/** Keep in sync with `STATUSES` in `src/routes/pegawai.schema.ts`. */
const STATUSES = ["aktif", "nonaktif", "cuti"];

const JABATAN = [
  "Staf",
  "Analis",
  "Auditor",
  "Programmer",
  "Sekretaris",
  "Kepala Bagian",
  "Manajer",
  "Direktur",
];

const UNIT_KERJA = [
  "Bagian Umum",
  "Bagian Hukum",
  "Bagian Pengadaan",
  "Bagian Pengawasan Internal",
  "Divisi Keuangan",
  "Divisi Operasional",
  "Divisi Pemasaran",
  "Divisi Sumber Daya Manusia",
  "Divisi Teknologi Informasi",
];

function parseNumber(args: string[], flag: string, fallback: number) {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;

  const raw = args[index + 1];
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return value;
}

const args = process.argv.slice(2);
const count = parseNumber(args, "--count", 50);
const seedNumber = parseNumber(args, "--seed", 12345);
const shouldReset = args.includes("--reset");

// Prefer the direct/session connection, exactly like `db:migrate`; the seed is
// a one-off Node script, so the Worker's per-request client rules do not apply.
const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;

if (!url) {
  console.error(
    "DATABASE_URL is not set. Copy .dev.vars.example to .dev.vars or export DATABASE_URL.",
  );
  process.exit(1);
}

const { db, close } = createDatabase(url);

try {
  // A deterministic seed produces the same NIP/email on every run, so seeding a
  // non-empty table would hit the partial unique indexes. Require an explicit
  // `--reset` instead of silently duplicating or truncating data.
  const [existing] = await db
    .select({ uuid: pegawai.uuid })
    .from(pegawai)
    .limit(1);

  if (existing && !shouldReset) {
    console.error(
      "pegawai is not empty. Re-run with `--reset` to truncate it (drizzle-seed `reset`) before seeding.",
    );
    process.exitCode = 1;
  } else {
    if (shouldReset) {
      // drizzle-seed `reset` runs `TRUNCATE ... CASCADE` on the given schema.
      await reset(db, { pegawai });
      console.log("Truncated pegawai (--reset).");
    }

    await seed(db, { pegawai }, { count, seed: seedNumber }).refine((f) => ({
      pegawai: {
        columns: {
          // 18-digit NIP, unique across the batch. Postgres coerces the number
          // to the text column; `isUnique` matters because the DB uniqueness is
          // a partial index on `lower(nip)`, which drizzle-seed cannot detect.
          nip: f.int({
            minValue: 100000000000000000n,
            maxValue: 999999999999999999n,
            isUnique: true,
          }),
          nama: f.fullName(),
          email: f.email(),
          jabatan: f.valuesFromArray({ values: JABATAN }),
          unitKerja: f.valuesFromArray({ values: UNIT_KERJA }),
          telepon: f.phoneNumber({ template: "+62 8##-####-####" }),
          alamat: f.streetAddress(),
          status: f.valuesFromArray({ values: STATUSES }),
          tanggalMasuk: f.date({
            minDate: "2010-01-01",
            maxDate: "2025-12-31",
          }),
          createdAt: f.timestamp(),
          updatedAt: f.timestamp(),
          // Audit/soft-delete columns stay NULL: there is no users table yet and
          // seeded rows must be visible to the API.
          createdBy: f.default({ defaultValue: null }),
          updatedBy: f.default({ defaultValue: null }),
          deletedBy: f.default({ defaultValue: null }),
          deletedAt: f.default({ defaultValue: null }),
        },
      },
    }));

    console.log(`Seeded ${count} pegawai (seed=${seedNumber}).`);
  }
} finally {
  await close();
}
