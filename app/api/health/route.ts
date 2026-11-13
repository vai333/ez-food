import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, dbKind } from "@/lib/db/client";
import { llmConfigured, env } from "@/lib/env";

export const dynamic = "force-dynamic";
export async function GET() {
  let db = false;
  try { await (await getDb()).execute(sql`select 1`); db = true; } catch {}
  return NextResponse.json({ ok: db, db: dbKind(), ai: llmConfigured(), push: !!env().VAPID_PUBLIC_KEY, cron: !!env().CRON_SECRET });
}
