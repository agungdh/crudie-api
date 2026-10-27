import { Hono } from "hono";
import type { AppEnv } from "./db/middleware";

const app = new Hono<AppEnv>();

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
