import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
config({ path: ".env.local", quiet: true });
const sql = neon(process.env.DATABASE_URL);
const t = await sql`select table_name from information_schema.tables where table_schema='public' order by 1`;
console.log(t.length, "tables:", t.map((x) => x.table_name).join(", "));
