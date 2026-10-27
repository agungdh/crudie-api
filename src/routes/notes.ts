import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { database, type AppEnv } from "../db/middleware";
import { notes } from "../db/schema";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const notesRoute = new Hono<AppEnv>();

notesRoute.use("*", database);

function parseBody(value: unknown) {
  if (typeof value !== "object" || value === null) return null;
  const { title, content } = value as Record<string, unknown>;

  if (title !== undefined && (typeof title !== "string" || !title.trim())) {
    return null;
  }
  if (content !== undefined && content !== null && typeof content !== "string") {
    return null;
  }

  return {
    title: typeof title === "string" ? title.trim() : undefined,
    content: content === undefined ? undefined : content,
  };
}

notesRoute.get("/", async (c) => {
  const rows = await c
    .get("db")
    .select()
    .from(notes)
    .orderBy(desc(notes.createdAt))
    .limit(100);

  return c.json({ data: rows });
});

notesRoute.get("/:id", async (c) => {
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "Invalid id" }, 400);

  const [row] = await c
    .get("db")
    .select()
    .from(notes)
    .where(eq(notes.id, id))
    .limit(1);

  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ data: row });
});

notesRoute.post("/", async (c) => {
  const body = parseBody(await c.req.json().catch(() => null));
  if (!body?.title) return c.json({ error: "title is required" }, 400);

  const [row] = await c
    .get("db")
    .insert(notes)
    .values({ title: body.title, content: body.content ?? null })
    .returning();

  return c.json({ data: row }, 201);
});

notesRoute.patch("/:id", async (c) => {
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "Invalid id" }, 400);

  const body = parseBody(await c.req.json().catch(() => null));
  if (!body || (body.title === undefined && body.content === undefined)) {
    return c.json({ error: "Nothing to update" }, 400);
  }

  const [row] = await c
    .get("db")
    .update(notes)
    .set({
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.content !== undefined ? { content: body.content } : {}),
    })
    .where(eq(notes.id, id))
    .returning();

  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ data: row });
});

notesRoute.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) return c.json({ error: "Invalid id" }, 400);

  const [row] = await c
    .get("db")
    .delete(notes)
    .where(eq(notes.id, id))
    .returning({ id: notes.id });

  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ data: row });
});
