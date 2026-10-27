import { Hono } from "hono";
import type { AppEnv } from "./db/middleware";
import { filesRoute } from "./routes/files";
import { notesRoute } from "./routes/notes";

const app = new Hono<AppEnv>();

app.get("/message", (c) => {
  return c.text("Hello Hono!");
});

app.route("/api/notes", notesRoute);
app.route("/api/files", filesRoute);

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
