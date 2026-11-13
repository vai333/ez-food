import fs from "node:fs";
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

type Holder = { db?: Promise<Db>; kind?: "neon" | "pglite"; close?: () => Promise<void> };
const g = globalThis as unknown as { __ezfDb?: Holder };
const holder: Holder = (g.__ezfDb ??= {});

/**
 * Lazy singleton. DATABASE_URL set  -> Neon Postgres over WebSocket (pooled string, supports transactions).
 * DATABASE_URL empty               -> local PGlite (real Postgres in WASM) in .data/pglite, so the app runs
 *                                     with no keys. Same schema, same queries.
 */
export function getDb(): Promise<Db> {
  if (!holder.db) holder.db = connect();
  return holder.db;
}

export function dbKind() {
  return process.env.DATABASE_URL ? "neon" : "pglite";
}

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    const { drizzle } = await import("drizzle-orm/neon-serverless");
    if (typeof WebSocket === "undefined") {
      const ws = (await import("ws")).default;
      neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
    }
    const pool = new Pool({ connectionString: url });
    holder.kind = "neon";
    holder.close = () => pool.end();
    return drizzle(pool, { schema }) as unknown as Db;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
  if (dir !== "memory://") fs.mkdirSync(path.dirname(dir), { recursive: true });
  const client = dir === "memory://" ? new PGlite() : new PGlite(dir);
  await client.waitReady;
  const db = drizzle(client, { schema });
  if (process.env.DB_NO_AUTO_MIGRATE !== "1") await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  holder.kind = "pglite";
  holder.close = () => client.close();
  return db as unknown as Db;
}

export async function closeDb() {
  await holder.close?.();
  holder.db = undefined;
}

export { schema };
