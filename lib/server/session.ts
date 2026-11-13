/**
 * Minimal device session (docs/DECISIONS.md D-02): onboarding creates the user and sets a signed, httpOnly cookie.
 * Google sign-in (Auth.js) is the planned upgrade once OAuth credentials exist; every query is already user-scoped.
 */
import "server-only";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { eq, and, isNull } from "drizzle-orm";
import { getDb } from "../db/client";
import * as s from "../db/schema";

const COOKIE = "ezf_sid";

function secret(): Uint8Array {
  let sec = process.env.AUTH_SECRET;
  if (!sec) {
    // Local dev only: persist a random secret so sessions survive restarts.
    const f = path.join(process.cwd(), ".data", "auth-secret");
    try {
      sec = fs.readFileSync(f, "utf8").trim();
    } catch {
      sec = crypto.randomBytes(32).toString("hex");
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, sec, { mode: 0o600 });
    }
  }
  return new TextEncoder().encode(sec);
}

export async function setSession(userId: string) {
  const token = await new SignJWT({ uid: userId }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("365d").sign(secret());
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 365 * 86400 });
}

export async function clearSession() {
  (await cookies()).delete(COOKIE);
}

export type User = typeof s.users.$inferSelect;

export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const db = await getDb();
    const [u] = await db.select().from(s.users).where(and(eq(s.users.id, String(payload.uid)), isNull(s.users.deletedAt))).limit(1);
    return u ?? null;
  } catch {
    return null;
  }
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) throw new HttpError(401, "unauthenticated", "Please finish onboarding first.");
  return u;
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export const sha256 = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
