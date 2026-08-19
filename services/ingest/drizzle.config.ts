// See services/app-api/drizzle.config.ts's identical comment. Ingest uses
// a separate config/migrations dir since it declares an overlapping-but-
// not-identical subset of tables (no orgs/users/sessions — see schema.ts's
// header comment on the `events` table's staged-only status).
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://mcpseal:mcpseal@localhost:5433/mcpseal",
  },
});
