import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * True when a real database connection string is configured (the .env.example
 * placeholder doesn't count). Without one, the dashboard serves sample data
 * and the bot tick refuses to run.
 */
export function hasDatabase(): boolean {
  const url = process.env.DATABASE_URL;
  return Boolean(url && !url.includes("user:password@host"));
}

let cached: ReturnType<typeof createDb> | null = null;

function createDb() {
  const sql = neon(process.env.DATABASE_URL!);
  return drizzle(sql, { schema });
}

export function getDb() {
  if (!hasDatabase()) {
    throw new Error("DATABASE_URL is not configured");
  }
  cached ??= createDb();
  return cached;
}

export { schema };
