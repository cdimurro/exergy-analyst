/**
 * Database client — Drizzle ORM with Neon serverless.
 *
 * Falls back gracefully when DATABASE_URL is not set (local dev mode).
 */

import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import * as schema from "./schema";

let _db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (_db) return _db;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL not set. Database features require a Neon Postgres connection."
    );
  }

  const pool = new Pool({ connectionString: url });
  _db = drizzle(pool, { schema });
  return _db;
}

/**
 * Check if database is available (for graceful fallback).
 */
export function isDatabaseAvailable(): boolean {
  return !!process.env.DATABASE_URL;
}
