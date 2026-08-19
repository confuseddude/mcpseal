// build-bible.md Part 5.1 / CLAUDE.md tech-stack note ("Postgres via a
// migration tool... pick one early"). Drizzle chosen for the App API.
// Generates SQL migrations from src/schema.ts into ./migrations — the
// production DDL, independent of the SQLite dev implementation in db.ts.
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://mcpseal:mcpseal@localhost:5433/mcpseal",
  },
});
