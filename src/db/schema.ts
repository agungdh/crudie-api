import { sql } from "drizzle-orm";
import {
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
 * the same type as the user id (`uuid`). No FKs and no indexes on these columns.
 */
export function auditColumns() {
  return {
    createdAt: timestamp("created_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    deletedBy: uuid("deleted_by"),
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

export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  content: text("content"),
  ...auditColumns(),
});

export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;
