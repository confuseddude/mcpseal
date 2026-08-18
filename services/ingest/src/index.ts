import path from "node:path";
import { homedir } from "node:os";
import { buildApp } from "./app.js";

const dbPath = process.env.MCPLOCK_INGEST_DB ?? path.join(homedir(), ".mcplock", "ingest-dev.sqlite3");
const port = Number(process.env.PORT ?? 8787);

const app = buildApp(dbPath);
app
  .listen({ port, host: "127.0.0.1" })
  .then(() => {
    console.log(`mcplock ingest (dev) listening on http://127.0.0.1:${port}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
