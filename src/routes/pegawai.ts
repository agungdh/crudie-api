import {
  and,
  asc,
  desc,
  eq,
  ilike,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { database, type AppEnv } from "../db/middleware";
import { pegawai, type Pegawai } from "../db/schema";
import { validateJson, validateParam, validateQuery } from "../lib/validation";
import {
  createPegawaiSchema,
  listPegawaiQuerySchema,
  SORT_KEYS,
  updatePegawaiSchema,
  uuidParamSchema,
} from "./pegawai.schema";

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

type SortKey = (typeof SORT_KEYS)[number];

/**
 * Columns a list request may sort by. Keys are asserted against `SORT_KEYS`
 * (the zod enum) so a new sortable column cannot drift between the two.
 */
const SORT_COLUMNS = {
  id: pegawai.id,
  nip: pegawai.nip,
  nama: pegawai.nama,
  status: pegawai.status,
  tanggalMasuk: pegawai.tanggalMasuk,
  createdAt: pegawai.createdAt,
  updatedAt: pegawai.updatedAt,
} as const satisfies Record<SortKey, AnyPgColumn>;

/**
 * Sort/keyset expression for a column. `id` is non-nullable; nullable columns
 * are folded to `''` so `(sortValue, id)` comparisons remain a total order even
 * when the value is NULL (nulls then sort first in asc and last in desc).
 */
function sortExpression(key: SortKey) {
  const column = SORT_COLUMNS[key];
  return key === "id" ? sql`${column}` : sql`coalesce(${column}::text, '')`;
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

/**
 * Keyset pagination: `?after=<uuid>` is the last row of the previous page,
 * filters and sort stay plain sibling query params (never encoded in the
 * cursor), and `nextCursor` is null on the last page. The default order is
 * `id desc`, i.e. newest first.
 */
pegawaiRoute.get("/", validateQuery(listPegawaiQuerySchema), async (c) => {
  const db = c.get("db");
  const { limit, sort, order, status, q, after } = c.req.valid("query");

  const conditions: SQL[] = [isNull(pegawai.deletedAt)];

  if (status) conditions.push(eq(pegawai.status, status));

  if (q) {
    const pattern = `%${q}%`;
    const search = or(
      ilike(pegawai.nip, pattern),
      ilike(pegawai.nama, pattern),
      ilike(pegawai.email, pattern),
    );
    if (search) conditions.push(search);
  }

  const sortExpr = sortExpression(sort);
  const direction = order === "asc" ? asc : desc;

  if (after) {
    const [cursor] = await db
      .select({ id: pegawai.id, value: sortExpr })
      .from(pegawai)
      .where(eq(pegawai.uuid, after))
      .limit(1);

    if (!cursor) return c.json({ error: "Invalid cursor" }, 400);

    // Keyset comparison on (sortValue, id): `>` walks asc, `<` walks desc.
    const operator = sql.raw(order === "asc" ? ">" : "<");
    conditions.push(
      sql`(${sortExpr}, ${pegawai.id}) ${operator} (${cursor.value}, ${cursor.id})`,
    );
  }

  const rows = await db
    .select()
    .from(pegawai)
    .where(and(...conditions))
    .orderBy(
      ...(sort === "id"
        ? [direction(pegawai.id)]
        : [direction(sortExpr), direction(pegawai.id)]),
    )
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return c.json({
    data: page.map(serialize),
    meta: {
      nextCursor: hasMore ? page[page.length - 1]?.uuid ?? null : null,
    },
  });
});

pegawaiRoute.get("/:uuid", validateParam(uuidParamSchema), async (c) => {
  const { uuid } = c.req.valid("param");

  const [row] = await c
    .get("db")
    .select()
    .from(pegawai)
    .where(and(eq(pegawai.uuid, uuid), isNull(pegawai.deletedAt)))
    .limit(1);

  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ data: serialize(row) });
});

pegawaiRoute.post("/", validateJson(createPegawaiSchema), async (c) => {
  const values = c.req.valid("json");
  const now = new Date();

  try {
    const [row] = await c
      .get("db")
      .insert(pegawai)
      .values({ ...values, createdAt: now, updatedAt: now })
      .returning();

    return c.json({ data: serialize(row) }, 201);
  } catch (err) {
    const error = conflict(err);
    if (error) return c.json(error, 409);
    throw err;
  }
});

pegawaiRoute.patch(
  "/:uuid",
  validateParam(uuidParamSchema),
  validateJson(updatePegawaiSchema),
  async (c) => {
    const { uuid } = c.req.valid("param");
    const values = c.req.valid("json");

    try {
      const [row] = await c
        .get("db")
        .update(pegawai)
        .set({ ...values, updatedAt: new Date() })
        .where(and(eq(pegawai.uuid, uuid), isNull(pegawai.deletedAt)))
        .returning();

      if (!row) return c.json({ error: "Not found" }, 404);
      return c.json({ data: serialize(row) });
    } catch (err) {
      const error = conflict(err);
      if (error) return c.json(error, 409);
      throw err;
    }
  },
);

/** Soft delete: the row stays, but disappears from list/detail and frees NIP/email. */
pegawaiRoute.delete("/:uuid", validateParam(uuidParamSchema), async (c) => {
  const { uuid } = c.req.valid("param");
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

pegawaiRoute.post(
  "/:uuid/restore",
  validateParam(uuidParamSchema),
  async (c) => {
    const { uuid } = c.req.valid("param");

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
  },
);
