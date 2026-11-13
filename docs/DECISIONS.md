# Decisions

Each entry: what was chosen, what was given up, and why. Safety rules (build prompt §3) outrank every feature.

## D-01 · Name and visual direction
- **Name:** "Aahaar" → **EZ FOOD** (owner request). `APP_NAME` lives in `lib/types.ts`.
- **Look:** the owner asked for the UI/UX of awmedia.marketing. We reproduce its *design language*: pure black canvas, Rethink Sans, oversized tight-tracked headlines with a grey gradient tail, glossy white pill CTAs, ghost pills, glass nav pill, hairline cards with soft radial light, corner-arrow tiles, marquee rails, numbered steps, big stat tiles, FAQ accordion. We do **not** copy their logo, copy, imagery or client names.
- **Conflict with the build prompt §13 ("Haldi & Tulsi", warm paper, light theme):** owner's explicit request wins. The prompt's *product* rules are kept: one primary action per screen, ≥ 48 px targets, thumb-zone primary buttons, body ≥ 16 px, cooking body ≥ 22 px, reduced-motion support. Dark only (the reference is dark only).

## D-02 · Auth
- Build prompt asks for Auth.js + Google with an email allow-list. No OAuth credentials exist yet, so v1 uses a **signed httpOnly device session** (jose, `lib/server/session.ts`) created at onboarding. Every query is still `userId`-scoped, so swapping in Auth.js later is local to `session.ts`.
- Trade-off: one device = one account until Google sign-in is added. Recorded in REVIEW_QUEUE.

## D-03 · Database
- Drizzle + Postgres. `DATABASE_URL` set → Neon (serverless driver); empty → **PGlite** (real Postgres in WASM) in `.data/pglite`, auto-migrated. Same schema, same queries.
- Plan + curated recipes and the interventions library live **in code** (`lib/seed/*`, reviewed, typed, unit-tested) instead of being duplicated into tables. The `recipes` table holds AI-generated and admin-reviewed recipes only.
- `memory_chunks` uses weighted, recency-decayed **keyword** retrieval in v1. pgvector embeddings are the planned upgrade (column intentionally not added until Neon is connected).

## D-04 · Gemini
- Key reused from Safar Saathi: it is an **OpenRouter** key, so the default transport is OpenRouter's OpenAI-compatible API with model `google/gemini-3.5-flash`. A direct Google AI Studio transport is included (`LLM_PROVIDER=gemini`).
- Gemini rejects parts of standard JSON Schema; `geminiSchema()` strips unsupported keys, with a fallback to `json_object` mode + schema-in-prompt on HTTP 400.
- Candidates are parsed **one by one**, so one malformed candidate doesn't sink the batch.
- `reasoning: { effort: "low" }` cut live latency from ~26 s to ~15 s for generator + council (Vercel Hobby limit 30 s).
- The AI is only called when deterministic retrieval finds < 3 strong matches, and never outside the eating window or in red-flag state.

## D-05 · Scheduling algorithm (Branch → Critique → Merge)
- Candidates: (A) greedy per-meal shift; (B) exhaustive search on a 5-minute grid with a cost function; (C) constraint solver library.
- Kabir: A fails silently on chains of meetings. Anjali/Meera: any option that crosses 20:00 is vetoed. C adds a dependency for a 3-variable problem.
- **Merged:** B as depth-first search with branch-and-bound. Cost = |shift|, with later shifts cheaper for the first meal and earlier shifts cheaper for the last. Hard constraints: window, 150–300 min gaps, prep block + 10 min travel buffer clear of busy blocks. Infeasible → options: no-cook, compress to two meals, extend window by ≤ 30 min (explicit confirmation), and a last-resort "3-minute no-cook at your desk".
- Verified by 14 unit + 3 property tests (fast-check).

## D-06 · Morning activation
- Three layers as specified: token webhook (`/api/hooks/wake`, hashed token, constant-time compare, per-day dedupe, rate-limited), scheduled push at the learned wake time (median of last 7 acks, clamped 06:00–08:00), and a first-open takeover between 06:00–08:00. After 08:00 a banner; after 12:00 silently "missed".

## D-07 · Gamification (owner request) vs "streak-free, compassion mode" (§9.2) and "not gamified-garish" (§2.1)
- Owner asked for gamification that keeps him stuck to the routine. Merged with the compassion principles:
  - **XP** for showing up and adapting: ginger water 15, meal on plan 25 (+10 on-time combo), compliant swap 20, emergency option 15, prep 15, water 2 (cap 10), check-in 5, chef mode 10, reflection 10, perfect day 50. XP never decreases.
  - **10 levels** (Sprout → EZ Legend).
  - **Consistency chain with shields** instead of a streak: a day counts at ≥ 3 of 4 slots (swaps and emergency count). Every 3 counted days earns a shield (max 2) that auto-protects an off day. With no shield, the chain restarts as a "fresh start" (never "streak lost"), and the best chain is kept. Today is never penalised early.
  - **3 daily quests** (deterministic per day), **21 badges** (bronze/silver/gold), **Lucky Bowl** variable reward (1 in 5 logged meals, deterministic per meal so refreshes can't farm it).
  - Monochrome, tasteful motion (no confetti), "Days on plan: x of 7" kept.
- Never: leaderboards, weight or calorie numbers, loss framing.

## D-08 · Learning loop
- Beta-Bernoulli **Thompson sampling** with ε = 10 % exploration and hierarchical back-off (`lib/engine/bandit.ts`). Keys: `recipe:*`, `tone:*`, `itype:*`, `emergency:*`, `prep_time:*`.
- Weekly insights are computed **deterministically** from events and check-ins with evidence counts (`buildInsights`). Gemini rewording is optional. Agree / Not me / Edit / Delete, forget, pause, consent toggle.
- Safety constraints are applied before ranking; learning can never relax them.

## D-09 · Notifications
- `notification_queue` + `/api/cron/tick` (GitHub Actions every 5 min) + daily Vercel cron at 20:00 IST. Atomic claim (`pending → sending`) prevents double sends. Max 6/day, quiet hours 22:00–06:00 except the wake push, per-type opt-out, suppressed after the user acts and in red-flag state.

## D-10 · Lint
- `react-hooks/set-state-in-effect` is a warning, not an error: the app uses the standard fetch-on-mount pattern. Reset-on-prop effects were replaced with `key`-based remounts.

## D-11 · Scope deferred (not faked)
- Google Calendar sync → manual busy blocks + "Meeting running late +30" (same scheduler path).
- Google Places lookup → copyable order note + Swiggy/Zomato/Maps search links.
- Full Hindi UI strings → Hindi recipe names only.
- Playwright e2e, LLM eval harness (50 golden + 30 red-team prompts), Storybook-lite `/design` route, doctor PDF export, learning simulation script.

## D-12 · Coach chat and week-by-week planning (owner request, 2026-11-13)
- **Weeks:** `user_plans` now holds one row per week (`week_no`, `menu` jsonb, `goals`, `summary`). Week 1 keeps `menu = null` (the original Menu A/B plan). The plan covering a date is the latest week that has started; after the last week ends, its menu repeats until a new week is confirmed (`lib/engine/plan.ts`).
- **Next-week chat** opens from Today on day 6–7 (or once the week is over): recap → short-term goal → busy days / cooking time / likes → a full 7-day `weekPlan` built from the catalog → the user confirms → week N+1 starts the day after week N ends.
- **Any-time chat** (`/coach`): preferences become proposals: `substitute_ingredient` (e.g. water → alkaline water in the drinks only), `avoid_ingredient` (with automatic plan-safe replacements), `hydration_drink`, `swap_meal`, `set_meal_time`, `set_goal`, `remember_note`.
- **Confirm before apply:** every proposal is stored as `pending` with a code-built preview (before/after per recipe, day-by-day replacements, full week). Only the Confirm button, or typing "confirm" while a proposal is waiting, applies it. Vague "yes / looks good" chips are stripped.
- **Code has the final say:** substitutions are re-validated (they can't add a banned food), the eating window and fat cap can't be changed by chat, and week plans pass `checkWeekMenu` (unknown, unsafe, doctor-gated, wrong-slot, over-fat and out-of-window items are repaired and listed).
- **Model quirks handled:** Gemini skips optional nested arrays, so the schema it sees *requires* 7 days in `weekPlan`. An incomplete plan is rebuilt by the deterministic planner (`lib/engine/weekplanner.ts`) from the user's own words. A reply lint drops sentences with medical claims or eating-window offers. The user's name is scrubbed from history before it reaches the model.
- **Fallback without AI:** scripted interview + deterministic planner; regex handling for "drink X water" / "avoid X".

## D-13 · Database
- Neon project (ap-southeast-1, Postgres 18) connected 2026-11-13: pooled URL for the app, direct URL for `drizzle-kit migrate`. Migrations `0000_init` and `0001_coach_and_weeks` applied; 21 tables. PGlite remains the fallback when `DATABASE_URL` is empty.
