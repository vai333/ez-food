/** Route-handler helper: authenticate → validate (Zod) → act → typed JSON, with one error shape. */
import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError, requireUser, type User } from "./session";

export function apiError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function handle<T>(fn: () => Promise<T>) {
  try {
    return NextResponse.json(await fn());
  } catch (e) {
    if (e instanceof HttpError) return apiError(e.status, e.code, e.message);
    if (e instanceof z.ZodError) return apiError(400, "invalid_input", z.prettifyError(e).slice(0, 400));
    console.error("[api]", e);
    return apiError(500, "server_error", "Something went wrong. Your data is safe; please try again.");
  }
}

export function authed<S extends z.ZodType>(schema: S | null, fn: (user: User, input: z.infer<S>, req: Request) => Promise<unknown>) {
  return (req: Request) =>
    handle(async () => {
      const user = await requireUser();
      let input: unknown = undefined;
      if (schema) {
        const body = req.method === "GET" ? Object.fromEntries(new URL(req.url).searchParams) : await req.json().catch(() => ({}));
        input = schema.parse(body);
      }
      return fn(user, input as z.infer<S>, req);
    });
}
