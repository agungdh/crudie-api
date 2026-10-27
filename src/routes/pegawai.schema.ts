import { z } from "zod";

/** Keep in sync with `pegawai.status` — validated here, not by the DB. */
export const STATUSES = ["aktif", "nonaktif", "cuti"] as const;

/**
 * Sortable fields. `id` is the default and always the final tiebreaker, so the
 * ordering is total and the keyset cursor cannot skip or repeat a row. The keys
 * must match `SORT_COLUMNS` in `./pegawai`.
 */
export const SORT_KEYS = [
  "id",
  "nip",
  "nama",
  "status",
  "tanggalMasuk",
  "createdAt",
  "updatedAt",
] as const;

const requiredText = (field: string, max: number) =>
  z
    .string({ error: `${field} must be a non-empty string` })
    .trim()
    .min(1, `${field} must be a non-empty string`)
    .max(max, `${field} must be at most ${max} characters`);

/**
 * `undefined` means "not sent" (PATCH must leave the column untouched), `null`
 * clears it, and a blank/whitespace-only string is treated as `null`.
 */
const optionalText = (field: string, max: number) =>
  z
    .string({ error: `${field} must be a string or null` })
    .trim()
    .max(max, `${field} must be at most ${max} characters`)
    .nullable()
    .optional()
    .transform((value) => (value === "" ? null : value));

const optionalEmail = z
  .string({ error: "email must be a valid email address or null" })
  .trim()
  .toLowerCase()
  .pipe(z.email("email must be a valid email address"))
  .nullable()
  .optional();

const optionalDate = z.iso
  .date("tanggalMasuk must be a valid YYYY-MM-DD date or null")
  .nullable()
  .optional();

const optionalStatus = z
  .enum(STATUSES, { error: `status must be one of: ${STATUSES.join(", ")}` })
  .optional();

/**
 * Create payload. Unknown keys are stripped (not rejected), so a client sending
 * extra fields keeps working; the DB defaults `status` to `aktif`.
 */
export const createPegawaiSchema = z.object({
  nip: requiredText("nip", 50),
  nama: requiredText("nama", 255),
  email: optionalEmail,
  jabatan: optionalText("jabatan", 255),
  unitKerja: optionalText("unitKerja", 255),
  telepon: optionalText("telepon", 32),
  alamat: optionalText("alamat", 1000),
  status: optionalStatus,
  tanggalMasuk: optionalDate,
});

/** Update payload: same fields, all optional, but at least one is required. */
export const updatePegawaiSchema = createPegawaiSchema
  .partial()
  .refine(
    (values) => Object.values(values).some((value) => value !== undefined),
    { error: "Nothing to update" },
  );

/** An empty query param (`?sort=&after=`) means the same as omitting it. */
function withoutEmptyStrings(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== ""),
  );
}

/**
 * List query. `after` is the uuid of the last row of the previous page; filters
 * and sort are plain sibling params and are never encoded in the cursor.
 */
export const listPegawaiQuerySchema = z.preprocess(
  withoutEmptyStrings,
  z.object({
    limit: z.coerce
      .number({ error: "limit must be an integer between 1 and 100" })
      .int("limit must be an integer between 1 and 100")
      .min(1, "limit must be an integer between 1 and 100")
      .max(100, "limit must be an integer between 1 and 100")
      .default(20),
    sort: z
      .enum(SORT_KEYS, {
        error: `sort must be one of: ${SORT_KEYS.join(", ")}`,
      })
      .default("id"),
    order: z
      .enum(["asc", "desc"], { error: "order must be asc or desc" })
      .default("desc"),
    status: z
      .enum(STATUSES, {
        error: `status must be one of: ${STATUSES.join(", ")}`,
      })
      .optional(),
    q: z
      .string({ error: "q must be a non-empty string" })
      .trim()
      .min(1, "q must be a non-empty string")
      .max(100, "q must be at most 100 characters")
      .optional(),
    after: z.uuid("Invalid cursor").optional(),
  }),
);

/** Path params are uuids; the integer `id` never appears in a URL. */
export const uuidParamSchema = z.object({
  uuid: z.uuid("Invalid uuid"),
});
