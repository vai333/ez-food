/**
 * The ONE module that talks to Gemini (build prompt §6.5). Server-only.
 * - Structured JSON output (JSON schema), parsed with Zod; one retry with the parse error, then give up (caller falls back).
 * - Daily call budget, 24 h cache keyed by prompt hash + profile version, timeout + exponential backoff, usage logged to ai_calls.
 * Provider: OpenRouter (OpenAI-compatible, model "google/gemini-…") or Google AI Studio REST directly.
 */
import "server-only";
import crypto from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { env, llmKey } from "../env";
import { getDb } from "../db/client";
import * as s from "../db/schema";

export type LlmCall<T> = {
  purpose: string;
  userId?: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  temperature: number;
  model?: "fast" | "reasoning";
  cacheKeyExtra?: string;
  maxOutputTokens?: number;
  /** Schema shown to the model when the parse schema is intentionally looser (e.g. per-item parsing). */
  schemaHint?: z.ZodType;
};

export type LlmResult<T> = { ok: true; data: T; cacheHit: boolean; callId: string } | { ok: false; error: string; budgetExceeded?: boolean };

type Transport = (req: { model: string; system: string; prompt: string; temperature: number; jsonSchema: unknown; maxTokens: number }) => Promise<{ text: string; inTok?: number; outTok?: number }>;

let testTransport: Transport | null = null;
/** Tests only. */
export function __setTransport(t: Transport | null) {
  testTransport = t;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let jsonObjectMode = false; // flips to true if the provider rejects json_schema
const openrouter: Transport = async ({ model, system, prompt, temperature, jsonSchema, maxTokens }) => {
  const send = (objectMode: boolean) =>
    fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${llmKey()}`, "Content-Type": "application/json", "X-Title": "EZ FOOD" },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        // Structured, short outputs: keep model "thinking" minimal for latency (serverless 30 s budget).
        reasoning: { effort: "low" },
        messages: [
          { role: "system", content: objectMode ? `${system}\n\nReturn ONLY a JSON object matching this JSON Schema:\n${JSON.stringify(jsonSchema)}` : system },
          { role: "user", content: prompt },
        ],
        response_format: objectMode ? { type: "json_object" } : { type: "json_schema", json_schema: { name: "result", strict: false, schema: jsonSchema } },
      }),
      signal: AbortSignal.timeout(25_000),
    });
  let res = await send(jsonObjectMode);
  if (res.status === 400 && !jsonObjectMode) {
    jsonObjectMode = true;
    res = await send(true);
  }
  if (!res.ok) throw new Error(`openrouter ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  return { text: j.choices?.[0]?.message?.content ?? "", inTok: j.usage?.prompt_tokens, outTok: j.usage?.completion_tokens };
};

const google: Transport = async ({ model, system, prompt, temperature, jsonSchema, maxTokens }) => {
  const name = model.replace(/^google\//, "");
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${name}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": llmKey(), "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature, maxOutputTokens: maxTokens, responseMimeType: "application/json", responseJsonSchema: jsonSchema },
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
  return { text: j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "", inTok: j.usageMetadata?.promptTokenCount, outTok: j.usageMetadata?.candidatesTokenCount };
};

/** Gemini's structured output accepts an OpenAPI-style subset of JSON Schema. Strip what it rejects. */
export function geminiSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(geminiSchema);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (["$schema", "additionalProperties", "exclusiveMinimum", "exclusiveMaximum", "default", "$id", "$ref", "definitions", "$defs", "pattern", "format"].includes(k)) continue;
    out[k] = geminiSchema(v);
  }
  return out;
}

function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const a = t.search(/[[{]/);
  const b = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  return JSON.parse(a >= 0 && b > a ? t.slice(a, b + 1) : t);
}

export const modelLabel = () => (testTransport ? "test-model" : env().GEMINI_MODEL_FAST);

export async function callsToday(): Promise<number> {
  const db = await getDb();
  const since = new Date(Date.now() - 24 * 3600_000);
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(s.aiCalls).where(and(gte(s.aiCalls.ts, since), eq(s.aiCalls.cacheHit, false)));
  return r?.n ?? 0;
}

export async function llmJson<T>(call: LlmCall<T>): Promise<LlmResult<T>> {
  if (!testTransport && !llmKey()) return { ok: false, error: "No Gemini key configured" };
  const e = env();
  const model = call.model === "reasoning" ? e.GEMINI_MODEL_REASONING : e.GEMINI_MODEL_FAST;
  const jsonSchema = geminiSchema(z.toJSONSchema(call.schemaHint ?? call.schema, { target: "draft-7", io: "input" }));
  const promptHash = crypto.createHash("sha256").update(JSON.stringify([call.purpose, model, call.system, call.prompt, call.temperature, call.cacheKeyExtra ?? ""])).digest("hex");
  const db = await getDb();

  // 24 h cache
  const since = new Date(Date.now() - 24 * 3600_000);
  const [hit] = await db.select().from(s.aiCalls).where(and(eq(s.aiCalls.promptHash, promptHash), gte(s.aiCalls.ts, since), sql`${s.aiCalls.response} is not null`)).limit(1);
  if (hit) {
    const parsed = call.schema.safeParse(hit.response);
    if (parsed.success) {
      const [row] = await db.insert(s.aiCalls).values({ userId: call.userId, purpose: call.purpose, model, promptHash, cacheHit: true, latencyMs: 0 }).returning({ id: s.aiCalls.id });
      return { ok: true, data: parsed.data, cacheHit: true, callId: row.id };
    }
  }

  if ((await callsToday()) >= e.AI_DAILY_CALL_BUDGET) {
    await db.insert(s.aiCalls).values({ userId: call.userId, purpose: call.purpose, model, promptHash, fallbackUsed: true, error: "budget_exceeded" });
    return { ok: false, error: "Daily AI budget reached", budgetExceeded: true };
  }

  const transport = testTransport ?? (e.LLM_PROVIDER === "gemini" || (!e.LLM_API_KEY && e.GEMINI_API_KEY) ? google : openrouter);
  const t0 = Date.now();
  let prompt = call.prompt;
  let lastErr = "";
  let inTok = 0, outTok = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await transport({ model, system: call.system, prompt, temperature: call.temperature, jsonSchema, maxTokens: call.maxOutputTokens ?? e.AI_MAX_OUTPUT_TOKENS });
      inTok += r.inTok ?? 0;
      outTok += r.outTok ?? 0;
      let raw: unknown;
      try {
        raw = extractJson(r.text);
      } catch (err) {
        throw new ParseError(`Invalid JSON: ${String(err).slice(0, 120)}`);
      }
      const parsed = call.schema.safeParse(raw);
      if (!parsed.success) throw new ParseError(z.prettifyError(parsed.error).slice(0, 600));
      const [row] = await db.insert(s.aiCalls).values({ userId: call.userId, purpose: call.purpose, model, promptHash, inputTokens: inTok, outputTokens: outTok, latencyMs: Date.now() - t0, response: parsed.data as object }).returning({ id: s.aiCalls.id });
      return { ok: true, data: parsed.data, cacheHit: false, callId: row.id };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      if (err instanceof ParseError) {
        if (attempt >= 1) break; // one retry with the parse error, then fall back
        prompt = `${call.prompt}\n\nYour previous reply did not match the schema: ${lastErr}\nReturn ONLY valid JSON matching the schema.`;
        continue;
      }
      await sleep(400 * 2 ** attempt);
    }
  }
  await db.insert(s.aiCalls).values({ userId: call.userId, purpose: call.purpose, model, promptHash, inputTokens: inTok, outputTokens: outTok, latencyMs: Date.now() - t0, fallbackUsed: true, error: lastErr.slice(0, 500) });
  return { ok: false, error: lastErr };
}

class ParseError extends Error {}
