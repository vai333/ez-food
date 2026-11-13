"use client";
/**
 * Client fetch helpers. GETs fall back to the last good copy in localStorage (offline Today/recipes).
 * POSTs made offline are queued (localStorage) and flushed when the connection returns.
 */
const QKEY = "ezf:queue";
const CKEY = (url: string) => `ezf:cache:${url}`;

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {}
}

export async function getJson<T>(url: string): Promise<T & { __offline?: boolean }> {
  try {
    const res = await fetch(url, { credentials: "include", cache: "no-store" });
    const body = await res.json();
    if (!res.ok) throw new ApiError(res.status, body?.error?.code ?? "error", body?.error?.message ?? "Request failed");
    safeSet(CKEY(url), JSON.stringify(body));
    return body;
  } catch (e) {
    if (e instanceof ApiError && e.code !== "offline") throw e;
    const cached = safeGet(CKEY(url));
    if (cached) return { ...JSON.parse(cached), __offline: true };
    throw e;
  }
}

export async function post<T = unknown>(url: string, body: unknown, opts: { queueable?: boolean; method?: string } = {}): Promise<T & { __queued?: boolean }> {
  const method = opts.method ?? "POST";
  if (typeof navigator !== "undefined" && !navigator.onLine && opts.queueable) {
    enqueue(url, body, method);
    return { __queued: true } as T & { __queued: boolean };
  }
  try {
    const res = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, j?.error?.code ?? "error", j?.error?.message ?? "Request failed");
    return j;
  } catch (e) {
    if (!(e instanceof ApiError) && opts.queueable) {
      enqueue(url, body, method);
      return { __queued: true } as T & { __queued: boolean };
    }
    throw e;
  }
}

function enqueue(url: string, body: unknown, method: string) {
  const q = JSON.parse(safeGet(QKEY) ?? "[]");
  q.push({ url, body, method, at: Date.now() });
  safeSet(QKEY, JSON.stringify(q.slice(-100)));
}

let flushing = false;
export async function flushQueue() {
  if (flushing || typeof navigator === "undefined" || !navigator.onLine) return;
  flushing = true;
  try {
    const q: { url: string; body: unknown; method: string }[] = JSON.parse(safeGet(QKEY) ?? "[]");
    const rest = [];
    for (const item of q) {
      try {
        const res = await fetch(item.url, { method: item.method, credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item.body) });
        if (res.status >= 500) rest.push(item);
      } catch {
        rest.push(item);
      }
    }
    safeSet(QKEY, JSON.stringify(rest));
  } finally {
    flushing = false;
  }
}

/** Batched behaviour events (idempotent by id). */
const evq: { id: string; type: string; entityId?: string; payload?: Record<string, unknown>; ts: number }[] = [];
let evTimer: ReturnType<typeof setTimeout> | null = null;
export function track(type: string, entityId?: string, payload?: Record<string, unknown>) {
  evq.push({ id: crypto.randomUUID(), type, entityId, payload, ts: Date.now() });
  if (evTimer) return;
  evTimer = setTimeout(() => {
    const events = evq.splice(0);
    evTimer = null;
    void post("/api/events", { events }, { queueable: true }).catch(() => {});
  }, 1500);
}

export function haptic(pattern: number | number[] = 12) {
  try {
    navigator.vibrate?.(pattern);
  } catch {}
}
