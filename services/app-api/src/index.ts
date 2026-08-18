import path from "node:path";
import { homedir } from "node:os";
import { buildApp } from "./app.js";

// Same default file ingest's dev DB uses, so orgs/workspaces/machines/
// events created by one service are visible to the other in local dev —
// mirrors "both services connect to the same Postgres instance" in prod.
const dbPath = process.env.MCPLOCK_CONTROL_PLANE_DB ?? process.env.MCPLOCK_INGEST_DB ?? path.join(homedir(), ".mcplock", "ingest-dev.sqlite3");
const port = Number(process.env.PORT ?? 8789);

const app = buildApp(dbPath);
app
  .listen({ port, host: "127.0.0.1" })
  .then(() => {
    console.log(`mcplock app-api (dev) listening on http://127.0.0.1:${port}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
