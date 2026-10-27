import { and, asc, count, eq, ilike, isNull, or, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { database, type AppEnv } from "../db/middleware";
import { pegawai, type NewPegawai, type Pegawai } from "../db/schema";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STATUSES = ["aktif", "nonaktif", "cuti"] as const;

const OPTIONAL_TEXT_FIELDS = [
  "jabatan",
  "unitKerja",
  "telepon",
  "alamat",
] as const;

export const pegawaiRoute = new Hono<AppEnv>();

pegawaiRoute.use("*", database);

/**
 * Public representation. The integer `id` and the audit `*_by` columns are
 * internal and never leave the Worker; `uuid` is the only identifier exposed.
 */
function serialize(row: Pegawai) {
  return {
    uuid: row.uuid,
    nip: row.nip,
    nama: row.nama,
    email: row.email,
    jabatan: row.jabatan,
    unitKerja: row.unitKerja,
    telepon: row.telepon,
    alamat: row.alamat,
    status: row.status,
    tanggalMasuk: row.tanggalMasuk,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function intParam(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

function isValidDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

type ParseResult =
  | { ok: true; values: Partial<NewPegawai>; touched: boolean }
  | { ok: false; error: string };

/**
 * Validates a JSON payload for create (`requireIdentity`) or update.
 * `undefined` means "not sent", `null` clears an optional field.
 */
function parseBody(payload: unknown, requireIdentity: boolean): ParseResult {
  if (!isPlainObject(payload)) {
    return { ok: false, error: "Body must be a JSON object" };
  }

  const values: Partial<NewPegawai> = {};
  let touched = false;

  for (const field of ["nip", "nama"] as const) {
    const raw = payload[field];
    if (raw === undefined) {
      if (requireIdentity) return { ok: false, error: `${field} is required` };
      continue;
    }
    if (typeof raw !== "string" || !raw.trim()) {
      return { ok: false, error: `${field} must be a non-empty string` };
    }
    values[field] = raw.trim();
    touched = true;
  }

  for (const field of OPTIONAL_TEXT_FIELDS) {
    const raw = payload[field];
    if (raw === undefined) continue;
    if (raw !== null && typeof raw !== "string") {
      return { ok: false, error: `${field} must be a string or null` };
    }
    values[field] = raw === null ? null : raw.trim() || null;
    touched = true;
  }

  if (payload.email !== undefined) {
    const raw = payload.email;
    if (raw === null) {
      values.email = null;
    } else if (typeof raw !== "string" || !EMAIL_RE.test(raw.trim())) {
      return { ok: false, error: "email must be a valid email address or null" };
    } else {
      values.email = raw.trim().toLowerCase();
    }
    touched = true;
  }

  if (payload.status !== undefined) {
    const raw = payload.status;
    if (
      typeof raw !== "string" ||
      !STATUSES.includes(raw as (typeof STATUSES)[number])
    ) {
      return { ok: false, error: `status must be one of: ${STATUSES.join(", ")}` };
    }
    values.status = raw;
    touched = true;
  }

  if (payload.tanggalMasuk !== undefined) {
    const raw = payload.tanggalMasuk;
    if (raw === null) {
      values.tanggalMasuk = null;
    } else if (
      typeof raw !== "string" ||
      !DATE_RE.test(raw) ||
      !isValidDate(raw)
    ) {
      return {
        ok: false,
        error: "tanggalMasuk must be a valid YYYY-MM-DD date or null",
      };
    } else {
      values.tanggalMasuk = raw;
    }
    touched = true;
  }

  return { ok: true, values, touched };
}

/**
 * Drizzle wraps driver errors in `DrizzleQueryError`, so the Postgres error
 * fields live on `cause`. Walks the chain to find them.
 */
function pgError(err: unknown) {
  let current: unknown = err;

  for (let depth = 0; depth < 5; depth++) {
    if (typeof current !== "object" || current === null) return null;

    const value = current as {
      code?: unknown;
      constraint_name?: unknown;
      cause?: unknown;
    };
    if (typeof value.code === "string") {
      return {
        code: value.code,
        constraint:
          typeof value.constraint_name === "string"
            ? value.constraint_name
            : undefined,
      };
    }

    current = value.cause;
  }

  return null;
}

/** Maps a Postgres unique violation (23505) to a 409 payload. */
function conflict(err: unknown): { error: string } | null {
  const pg = pgError(err);
  if (pg?.code !== "23505") return null;

  if (pg.constraint === "pegawai_nip_unique") return { error: "nip already exists" };
  if (pg.constraint === "pegawai_email_unique")
    return { error: "email already exists" };
  return { error: "Conflicting value" };
}

pegawaiRoute.get("/", async (c) => {
  const db = c.get("db");
  const limit = intParam(c.req.query("limit"), 20, 1, 100);
  const offset = intParam(c.req.query("offset"), 0, 0, 1_000_000);

  const conditions: SQL[] = [isNull(pegawai.deletedAt)];

  const status = c.req.query("status");
  if (status) {
    if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
      return c.json(
        { error: `status must be one of: ${STATUSES.join(", ")}` },
        400,
      );
    }
    conditions.push(eq(pegawai.status, status));
  }

  const q = c.req.query("q")?.trim();
  if (q) {
    const pattern = `%${q}%`;
    const search = or(
      ilike(pegawai.nip, pattern),
      ilike(pegawai.nama, pattern),
      ilike(pegawai.email, pattern),
    );
    if (search) conditions.push(search);
  }

  const where = and(...conditions);

  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(pegawai)
      .where(where)
      .orderBy(asc(pegawai.nama), asc(pegawai.id))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(pegawai).where(where),
  ]);

  return c.json({
    data: rows.map(serialize),
    meta: { total: total?.total ?? 0, limit, offset },
  });
});

pegawaiRoute.get("/:uuid", async (c) => {
  const uuid = c.req.param("uuid");
  if (!UUID_RE.test(uuid)) return c.json({ error: "Invalid uuid" }, 400);

  const [row] = await c
    .get("db")
    .select()
    .from(pegawai)
    .where(and(eq(pegawai.uuid, uuid), isNull(pegawai.deletedAt)))
    .limit(1);

  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ data: serialize(row) });
});

pegawaiRoute.post("/", async (c) => {
  const parsed = parseBody(await c.req.json().catch(() => null), true);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  const nip = parsed.values.nip;
  const nama = parsed.values.nama;
  if (typeof nip !== "string" || typeof nama !== "string") {
    return c.json({ error: "nip and nama are required" }, 400);
  }

  const now = new Date();

  try {
    const [row] = await c
      .get("db")
      .insert(pegawai)
      .values({ ...parsed.values, nip, nama, createdAt: now, updatedAt: now })
      .returning();

    return c.json({ data: serialize(row) }, 201);
  } catch (err) {
    const error = conflict(err);
    if (error) return c.json(error, 409);
    throw err;
  }
});

pegawaiRoute.patch("/:uuid", async (c) => {
  const uuid = c.req.param("uuid");
  if (!UUID_RE.test(uuid)) return c.json({ error: "Invalid uuid" }, 400);

  const parsed = parseBody(await c.req.json().catch(() => null), false);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  if (!parsed.touched) return c.json({ error: "Nothing to update" }, 400);

  try {
    const [row] = await c
      .get("db")
      .update(pegawai)
      .set({ ...parsed.values, updatedAt: new Date() })
      .where(and(eq(pegawai.uuid, uuid), isNull(pegawai.deletedAt)))
      .returning();

    if (!row) return c.json({ error: "Not found" }, 404);
    return c.json({ data: serialize(row) });
  } catch (err) {
    const error = conflict(err);
    if (error) return c.json(error, 409);
    throw err;
  }
});

/** Soft delete: the row stays, but disappears from list/detail and frees NIP/email. */
pegawaiRoute.delete("/:uuid", async (c) => {
  const uuid = c.req.param("uuid");
  if (!UUID_RE.test(uuid)) return c.json({ error: "Invalid uuid" }, 400);

  const now = new Date();
  const [row] = await c
    .get("db")
    .update(pegawai)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(pegawai.uuid, uuid), isNull(pegawai.deletedAt)))
    .returning({ uuid: pegawai.uuid, deletedAt: pegawai.deletedAt });

  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ data: row });
});

pegawaiRoute.post("/:uuid/restore", async (c) => {
  const uuid = c.req.param("uuid");
  if (!UUID_RE.test(uuid)) return c.json({ error: "Invalid uuid" }, 400);

  try {
    const [row] = await c
      .get("db")
      .update(pegawai)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(pegawai.uuid, uuid))
      .returning();

    if (!row) return c.json({ error: "Not found" }, 404);
    return c.json({ data: serialize(row) });
  } catch (err) {
    const error = conflict(err);
    if (error) return c.json(error, 409);
    throw err;
  }
});
