/** Plan weeks for a user (no other server imports, so any module can use it without cycles). */
import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import * as s from "../db/schema";
import type { PlanRow, WeekMenu } from "../engine/plan";

type PlanRecord = typeof s.userPlans.$inferSelect;
export type UserPlan = PlanRecord & PlanRow;

/** All active plan weeks, oldest first. */
export async function userPlans(userId: string): Promise<UserPlan[]> {
  const db = await getDb();
  const rows = await db.select().from(s.userPlans).where(and(eq(s.userPlans.userId, userId), eq(s.userPlans.status, "active"))).orderBy(asc(s.userPlans.startDate), desc(s.userPlans.createdAt));
  return rows.map((r) => ({ ...r, menu: (r.menu as WeekMenu | null) ?? null }));
}
