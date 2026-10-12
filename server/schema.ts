import { getMigrations } from "better-auth/db/migration";
import type { Pool } from "pg";
import type { authOptions } from "./auth";

export const AUTH_TABLES = ["user", "session", "account", "verification"] as const;

export function missingAuthTables(found: readonly string[]): string[] {
  const names = new Set(found);
  return AUTH_TABLES.filter((table) => !names.has(table));
}

/**
 * Creates missing Better Auth tables on the pool the app will query.
 * Runs before betterAuth() so its schema check cannot cache a miss.
 * Additive: existing tables and rows are left in place.
 */
export async function ensureAuthTables(pool: Pool, options: ReturnType<typeof authOptions>): Promise<void> {
  const plan = await getMigrations(options);
  const creating = plan.toBeCreated.map((table) => table.table);
  await plan.runMigrations();
  const found = await pool.query<{ schema: string; name: string }>(
    `SELECT n.nspname AS schema, c.relname AS name
     FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'r'
       AND c.relname = ANY($1::text[])
       AND n.nspname = ANY (pg_catalog.current_schemas(true))`,
    [AUTH_TABLES],
  );
  const missing = missingAuthTables(found.rows.map((row) => row.name));
  if (missing.length > 0) {
    const place = await pool.query<{ schema: string | null }>(`SELECT pg_catalog.current_schema() AS schema`);
    const schema = place.rows[0]?.schema ?? "unknown";
    throw new Error(`Auth tables are missing from schema ${schema}: ${missing.join(", ")}`);
  }
  const ready = found.rows
    .map((row) => `${row.schema}.${row.name}`)
    .sort()
    .join(", ");
  if (creating.length > 0) {
    console.log(`Auth migration created ${creating.join(", ")}`);
  }
  console.log(`Auth tables ready: ${ready}`);
}
