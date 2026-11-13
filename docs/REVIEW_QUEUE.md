# Review queue

Items that need a human (nutritionist, doctor or owner) before they are treated as final.

## Needs the nutritionist / doctor
- [ ] **All step timers and active/passive minutes** in `lib/seed/plan.ts` marked `source: "estimate"` (chilla, sprouts, lauki, dal, rice/roti, khichdi, raita).
- [ ] **Nutrition numbers** on every recipe (`nutrition.source: "estimate"`). The UI labels them "≈ estimate".
- [ ] **R8 cooking instructions** (brown rice / jowar roti) are estimated seed content.
- [ ] **R10 cucumber raita** details are estimated.
- [ ] **47 curated alternatives** (`lib/seed/curated-recipes.ts`): all pass the validator; confirm they suit the plan. Notes from the author:
  - `shakarkandi-chaat` (sweet potato, not a nightshade but starchy) is marked `needsDoctorOk` and hidden.
  - `banana-curd-cinnamon` and `tender-coconut-water` are `needsDoctorOk` and hidden.
  - `tur-dal-simple` and `lemon-pepper-jeera-saaru` use tur dal; confirm tolerance.
  - Several curated recipes use small amounts of onion (the plan doesn't ban it, but the plan's own recipes never use it).
- [ ] **Added-sugar ban** (sugar, honey, jaggery syrup): stricter than the written plan. Confirm or relax.
- [ ] **Strict capsicum default** (all chillies banned). Section 21 Q1.
- [ ] **23 health-fact interventions** in `lib/seed/interventions.ts` carry a named source; confirm wording.
- [ ] **AI-generated recipes** land in `/admin` as `pending_review`. They can be cooked immediately only if the deterministic validator passes with zero ambiguity.

## Needs the owner (Section 21 questions, defaults applied)
1. Chillies: all avoided (strict). 2. Fruits: plan's papaya + apple, pear, pomegranate, guava; banana and coconut water hidden. 3. Dinner carb: brown rice (switch in Settings). 4. Medicines: none tracked; never advised. 5. Language: English + Hindi names. 6. Phone: both wake recipes documented. 7. Calendar: manual busy blocks. 8. GitHub handle, domain, VAPID contact email: not set. 9. Start date: today (tomorrow after 20:00). 10. Doctor export: JSON now; PDF/CSV later.

## Coach
- [ ] **Ingredient densities** for unit conversion (`lib/engine/portions.ts`, e.g. 1 cup whole moong ≈ 200 g, 1 cup = 240 ml, 1 glass = 250 ml, 1 tsp ghee ≈ 5 g) are estimates.
- [ ] **kcal estimates** on every recipe drive calorie-target portions; the written plan is ≈ 820–1,015 kcal/day. Confirm any target with the nutritionist.
- [ ] AI-planned weeks only use approved recipes, but the nutritionist may want to review the first few coach-built weeks.
- [ ] Coach replies are linted for medical claims; spot-check transcripts occasionally (stored in `chat_messages`).

## Engineering follow-ups
- [ ] Google sign-in (Auth.js) with allow-list (D-02).
- [x] Neon project connected (ap-southeast-1), migrations applied. Vercel env vars still to set at deploy time.
- [ ] pgvector embeddings for memories (D-03).
- [ ] Playwright e2e + LLM eval harness (D-11).
