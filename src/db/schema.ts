import { sql } from "drizzle-orm";
import {
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/**
 * Audit columns required on **every** table.
 *
 * All nullable and default-less on purpose: rows written by the app (or before a
 * column existed) must stay valid, and the app decides the values. `*_by` uses
 * the same type as the user id (`integer`). No FKs and no indexes on these columns.
 */
export function auditColumns() {
  return {
    createdAt: timestamp("created_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdBy: integer("created_by"),
    updatedBy: integer("updated_by"),
    deletedBy: integer("deleted_by"),
  };
}

/**
 * Soft delete (`deleted_at`) means a unique index must be **partial**, otherwise
 * a deleted row would keep blocking reuse of the value. `lower()` is applied
 * because Postgres text comparison is case-sensitive, so `Foo` and `foo` must
 * still collide.
 *
 * Usage (inside the `pgTable` callback):
 *
 *   (t) => [
 *     partialLowerUniqueIndex("users_email_unique", t.email, t.deletedAt),
 *   ]
 */
export function partialLowerUniqueIndex(
  name: string,
  column: AnyPgColumn,
  deletedAt: AnyPgColumn,
) {
  return uniqueIndex(name)
    .on(sql`lower(${column})`)
    .where(sql`${deletedAt} is null`);
}

/**
 * Pegawai (employee). The integer `id` is internal; the API only ever exposes
 * `uuid`. `nip` and `email` are unique among rows that are not soft-deleted, so
 * a deleted pegawai's NIP/email can be reused.
 */
export const pegawai = pgTable(
  "pegawai",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    uuid: uuid("uuid").notNull().defaultRandom(),
    nip: text("nip").notNull(),
    nama: text("nama").notNull(),
    email: text("email"),
    jabatan: text("jabatan"),
    unitKerja: text("unit_kerja"),
    telepon: text("telepon"),
    alamat: text("alamat"),
    /** `aktif` | `nonaktif` | `cuti` — validated by the route, not by the DB. */
    status: text("status").notNull().default("aktif"),
    tanggalMasuk: date("tanggal_masuk", { mode: "string" }),
    ...auditColumns(),
  },
  (t) => [
    index("pegawai_uuid_idx").using("hash", t.uuid),
    partialLowerUniqueIndex("pegawai_nip_unique", t.nip, t.deletedAt),
    partialLowerUniqueIndex("pegawai_email_unique", t.email, t.deletedAt),
  ],
);

export type Pegawai = typeof pegawai.$inferSelect;
export type NewPegawai = typeof pegawai.$inferInsert;

