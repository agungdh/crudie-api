import { Hono } from "hono";
import type { AppEnv } from "./db/middleware";
import { pegawaiRoute } from "./routes/pegawai";

const app = new Hono<AppEnv>();

app.route("/api/pegawai", pegawaiRoute);

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
