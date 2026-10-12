import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createListeningApp } from "./app";

const { app } = await createListeningApp();
const port = Number(process.env.PORT) || 8787;
const servingBuiltApp = process.env.NODE_ENV === "production";

if (servingBuiltApp) {
  app.use("/*", serveStatic({ root: "./dist" }));
  app.get("*", serveStatic({ path: "./dist/index.html" }));
}

serve({ fetch: app.fetch, port }, () => {
  console.log(`ARStacksOps server listening on ${port}`);
});
