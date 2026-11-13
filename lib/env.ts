/** Server-only environment, validated with Zod at first use. Nothing here is ever sent to the browser. */
import "server-only";
import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.string().optional().default(""),
  AUTH_SECRET: z.string().optional().default(""),
  /** "openrouter" (default; OpenAI-compatible) or "gemini" (Google AI Studio REST). */
  LLM_PROVIDER: z.enum(["openrouter", "gemini"]).default("openrouter"),
  LLM_API_KEY: z.string().optional().default(""),
  GEMINI_API_KEY: z.string().optional().default(""),
  GEMINI_MODEL_FAST: z.string().default("google/gemini-3.5-flash"),
  GEMINI_MODEL_REASONING: z.string().default("google/gemini-3.5-flash"),
  AI_DAILY_CALL_BUDGET: z.coerce.number().int().positive().default(300),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(1500),
  VAPID_PUBLIC_KEY: z.string().optional().default(""),
  VAPID_PRIVATE_KEY: z.string().optional().default(""),
  VAPID_SUBJECT: z.string().default("mailto:owner@example.com"),
  CRON_SECRET: z.string().optional().default(""),
  APP_URL: z.string().default("http://localhost:3000"),
  ADMIN_USER_REFS: z.string().optional().default(""),
});

let cached: z.infer<typeof Env> | null = null;
export function env() {
  if (!cached) cached = Env.parse(process.env);
  return cached;
}

export const llmKey = () => env().LLM_API_KEY || env().GEMINI_API_KEY;
export const llmConfigured = () => !!llmKey();
